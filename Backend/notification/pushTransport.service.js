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

    console.log(`${traceId} Preparando Push para ${validTokens.length} token(s) válido(s). Payload title: ${payload.title}`);

    const message = {
        notification: {
            title: payload.title,
            body: payload.message,
            ...(payload.image ? { image: payload.image } : {})
        },
        data: payload.data || {},
        ...(payload.webpush ? { webpush: payload.webpush } : {})
    };

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
