const { getMessaging } = require('firebase-admin/messaging');

// Extraído de services/notification.service.js (Fase 4 da correção do sistema de push,
// 2026-08-02). Único módulo que fala com o Firebase Admin SDK. Responsabilidade: chunk
// de 500 tokens (limite real do sendEachForMulticast — M2 da auditoria: sem isso, uma
// campanha com mais de 500 destinatários falhava por inteiro), retry com backoff em
// falha transitória, timeout, e devolução de quais tokens falharam definitivamente
// (pra tokenRegistry poder limpar — A2).

const MAX_TOKENS_PER_CHUNK = 500;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 300;
const FIREBASE_TIMEOUT_MS = 10000;

// Códigos que o Firebase devolve quando o token está definitivamente morto — não
// adianta re-tentar, e não adianta continuar mandando pra ele no futuro.
const PERMANENT_FAILURE_CODES = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument'
]);

const chunkArray = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} excedeu ${ms}ms`)), ms))
]);

// Correção crítica do push de corrida (2026-08-03): o FCM exige que TODOS os valores
// de `data` sejam strings — `sendEachForMulticast` rejeita a mensagem inteira com
// `messaging/invalid-payload: data must only contain string values` ANTES de qualquer
// rede. Foi exatamente o que quebrou a push de "Nova corrida": o despacho passou a
// mandar `fare` como número (commit 5fba884) e toda notificação de corrida morria na
// validação do SDK, invisível aos testes (que mockam o firebase-admin). Converter aqui,
// na única fronteira com o SDK, protege todos os remetentes de uma vez.
const sanitizeDataValues = (data = {}) => {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        out[key] = typeof value === 'string'
            ? value
            : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return out;
};
module.exports.sanitizeDataValues = sanitizeDataValues;

const sendChunkWithRetry = async (tokens, message, traceId, attempt = 0) => {
    try {
        return await withTimeout(
            getMessaging().sendEachForMulticast({ ...message, tokens }),
            FIREBASE_TIMEOUT_MS,
            'Envio de push ao Firebase'
        );
    } catch (error) {
        if (attempt < MAX_RETRIES) {
            console.warn(`${traceId} Falha ao enviar lote de push (tentativa ${attempt + 1}/${MAX_RETRIES + 1}): ${error.message}. Tentando de novo...`);
            await sleep(RETRY_DELAY_MS * (attempt + 1));
            return sendChunkWithRetry(tokens, message, traceId, attempt + 1);
        }
        throw error;
    }
};

// Heads-up / NEW_RIDE (2026-08-04): com `notification` + `data` o Chrome Android
// desenha sozinho uma notificação básica (sem vibrate/requireInteraction/actions) E
// ainda chama onBackgroundMessage — o SW pode gerar uma segunda, ou a automática
// (sem prioridade visual) é a que o motorista vê. Data-only deixa o Service Worker
// como ÚNICA camada que chama showNotification, com as opções que maximizam a
// chance de heads-up. Outros tipos continuam com notification+data.
const buildFcmMessage = (payload) => {
    const data = sanitizeDataValues({
        ...(payload.data || {}),
        // Garante title/body no data mesmo em data-only — o SW precisa deles pra desenhar.
        title: payload.title,
        message: payload.message,
    });

    return {
        ...(payload.dataOnly ? {} : {
            notification: {
                title: payload.title,
                body: payload.message,
                ...(payload.image ? { image: payload.image } : {})
            }
        }),
        data,
        ...(payload.webpush ? { webpush: payload.webpush } : {})
    };
};
module.exports.buildFcmMessage = buildFcmMessage;

// Devolve { successCount, failureCount, invalidTokens }. Nunca lança — uma falha (mesmo
// depois de esgotar os retries) vira failureCount, não uma exceção pro chamador tratar.
module.exports.sendPush = async (tokens, payload, traceId = '[AUDIT]') => {
    if (!tokens || tokens.length === 0) {
        console.log(`${traceId} Envio de Push abortado: Nenhum token fornecido.`);
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const validTokens = [...new Set(tokens.filter(t => t && t.trim() !== ''))];
    if (validTokens.length !== tokens.length) {
        console.log(`${traceId} Aviso: ${tokens.length - validTokens.length} token(s) vazio(s)/duplicado(s) foram filtrados.`);
    }
    if (validTokens.length === 0) {
        console.log(`${traceId} Envio de Push abortado: Apenas tokens vazios encontrados.`);
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    console.log(`${traceId} Preparando Push para ${validTokens.length} token(s) válido(s). Payload title: ${payload.title}${payload.dataOnly ? ' [data-only]' : ''}`);

    const message = buildFcmMessage(payload);

    const chunks = chunkArray(validTokens, MAX_TOKENS_PER_CHUNK);
    let successCount = 0;
    let failureCount = 0;
    const invalidTokens = [];

    for (const tokenChunk of chunks) {
        try {
            const response = await sendChunkWithRetry(tokenChunk, message, traceId);
            successCount += response.successCount;
            failureCount += response.failureCount;

            if (response.failureCount > 0) {
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        // A4/M10 da auditoria de push (2026-08-02): nunca logar o token
                        // completo — é a credencial de endereçamento do push.
                        const redacted = `...${tokenChunk[idx].slice(-8)}`;
                        console.log(`${traceId} Falha no envio para token [${redacted}]: ${resp.error.message}`);
                        if (PERMANENT_FAILURE_CODES.has(resp.error.code)) {
                            invalidTokens.push(tokenChunk[idx]);
                        }
                    }
                });
            }
        } catch (error) {
            console.error(`${traceId} Erro fatal ao enviar lote de Push Notification (${tokenChunk.length} token(s)):`, error.message);
            failureCount += tokenChunk.length;
        }
    }

    console.log(`${traceId} Firebase Push finalizado: ${successCount} sucesso(s), ${failureCount} falha(s) em ${chunks.length} lote(s).`);

    return { successCount, failureCount, invalidTokens };
};
