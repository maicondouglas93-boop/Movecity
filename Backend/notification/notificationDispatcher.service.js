const Notification = require('../models/notification.model');
const NotificationCampaign = require('../models/notificationCampaign.model');
const userModel = require('../models/user.model');
const captainModel = require('../models/captain.model');
const cron = require('node-cron');
const tokenRegistry = require('./tokenRegistry.service');
const pushTransport = require('./pushTransport.service');
const queue = require('./queue.service');
const { resolveMeta, toInboxDTO } = require('./notificationMeta');

// Extraído de services/notification.service.js (Fase 4 da correção do sistema de push,
// 2026-08-02). Responsabilidade: decidir quem recebe o quê, gravar o histórico
// (Notification/NotificationCampaign) e delegar o envio de fato ao pushTransport.

/** Emite `notification-created` pro socket do destinatário (central in-app em tempo real). */
async function emitInboxRealtime(notification) {
    try {
        const { sendMessageToSocketId } = require('../socket');
        let socketId = null;
        if (notification.userId) {
            const user = await userModel.findById(notification.userId).select('socketId').lean();
            socketId = user?.socketId;
        } else if (notification.captainId) {
            const captain = await captainModel.findById(notification.captainId).select('socketId').lean();
            socketId = captain?.socketId;
        }
        if (!socketId) return;
        sendMessageToSocketId(socketId, {
            event: 'notification-created',
            data: toInboxDTO(notification),
        });
    } catch (err) {
        console.warn('[Notification] Falha ao emitir notification-created:', err.message);
    }
}

function enrichInboxFields(notificationData, payloadData = {}) {
    const meta = resolveMeta({
        type: notificationData.type,
        category: notificationData.category,
        priority: notificationData.priority,
        icon: notificationData.icon,
        action: notificationData.action,
        data: { ...payloadData, deepLink: payloadData.deepLink || notificationData.action },
    });
    const recipientType = notificationData.recipientType
        || (notificationData.userId ? 'passenger' : notificationData.captainId ? 'driver' : null);
    return {
        ...notificationData,
        recipientType,
        category: meta.category,
        priority: meta.priority,
        icon: meta.icon,
        action: meta.action,
        referenceId: notificationData.referenceId || meta.referenceId,
        referenceType: notificationData.referenceType || meta.referenceType,
        origin: notificationData.origin || 'system',
    };
}

// M4 da auditoria de push (2026-08-02): antes gravava status:'sent' incondicionalmente,
// antes mesmo de tentar enviar — o histórico afirmava uma entrega que podia nunca ter
// acontecido. Agora grava 'sending', tenta enviar, e só então grava o resultado real.
// Central de notificações: também preenche category/icon/action e emite socket in-app.
const recordAndSend = async (notificationData, tokens, payload, traceId = '[AUDIT]') => {
    const enriched = enrichInboxFields(notificationData, payload?.data || {});
    const notification = await Notification.create({ ...enriched, status: 'sending', sentAt: new Date() });
    const result = await pushTransport.sendPush(tokens, payload, traceId);

    notification.status = (tokens.length === 0 || result.successCount > 0) ? 'sent' : 'failed';
    await notification.save();

    if (result.invalidTokens.length > 0) {
        await tokenRegistry.removeInvalidTokens(result.invalidTokens);
    }

    // Inbox em tempo real (app aberto) — FCM cobre app fechado/background.
    if (notification.userId || notification.captainId) {
        emitInboxRealtime(notification).catch(() => {});
    }

    return result;
};

// C5 da auditoria de push (2026-08-02): try/catch envolvendo tudo — falha de
// notificação nunca pode derrubar quem chamou (criação de corrida, aceite, pagamento).
const sendToUser = async (userId, title, message, type, data = {}) => {
    try {
        const tokens = await tokenRegistry.getTokensForUser(userId);
        await recordAndSend({ userId, title, message, type, targetAudience: 'specific' }, tokens, { title, message, data });
    } catch (error) {
        console.error('[Notification] Erro ao notificar usuário:', error);
    }
};
// Exportada além de usada internamente: ride.controller.js chama diretamente na
// confirmação de pagamento (ver Bloco de auditoria de concorrência, P1.1).
module.exports.sendToUser = sendToUser;

const sendToCaptain = async (captainId, title, message, type, data = {}, options = {}, traceId = '[AUDIT]') => {
    try {
        console.log(`${traceId} Buscando tokens FCM para Captain ${captainId}...`);
        const tokens = await tokenRegistry.getTokensForCaptain(captainId);
        console.log(`${traceId} Encontrados ${tokens.length} tokens no banco para Captain ${captainId}.`);
        await recordAndSend({ captainId, title, message, type, targetAudience: 'specific' }, tokens, { title, message, data, ...options }, traceId);
    } catch (error) {
        console.error(`${traceId} Erro ao notificar motorista:`, error);
    }
};

// Primeiro pedaço do endereço (antes da vírgula) e sem o sufixo " (lat, lng)" que a
// Home grava — cabe no body da notificação sem estourar a prévia do Android.
const shortAddress = (address) => {
    if (!address) return '';
    const clean = String(address).replace(/\s*\(-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\)\s*$/, '');
    return clean.split(',')[0].trim();
};

module.exports.sendNewRide = async (captainId, data, traceId = '[AUDIT]') => {
    // Body rico sem botões Aceitar/Recusar (2026-08-04): valor, origem→destino,
    // distância e tempo — o toque abre a oferta no app.
    const fareLabel = typeof data.fare === 'number'
        ? `R$ ${data.fare.toFixed(2).replace('.', ',')}`
        : null;
    const pickupShort = shortAddress(data.pickup);
    const destShort = shortAddress(data.destination);
    const routeLabel = pickupShort && destShort
        ? `${pickupShort} → ${destShort}`
        : (pickupShort || destShort || null);
    const distanceKm = typeof data.estimatedDistance === 'number' && data.estimatedDistance > 0
        ? `${(data.estimatedDistance / 1000).toFixed(1).replace('.', ',')} km`
        : null;
    const durationMin = typeof data.estimatedTime === 'number' && data.estimatedTime > 0
        ? `${Math.max(1, Math.round(data.estimatedTime / 60))} min`
        : null;
    const passengerLabel = data.passengerName
        ? String(data.passengerName).trim().split(/\s+/)[0]
        : null;
    const vehicleLabel = data.vehicleType
        ? String(data.vehicleType)
        : null;

    const title = fareLabel ? `Nova corrida · ${fareLabel}` : 'Nova corrida disponível';
    const message = [
        routeLabel,
        [distanceKm, durationMin].filter(Boolean).join(' · ') || null,
        passengerLabel ? `Passageiro: ${passengerLabel}` : null,
        vehicleLabel,
    ].filter(Boolean).join('\n') || 'Abra o app para ver a oferta';

    const deepLinkPath = `${DEEP_LINK.captainHome}?rideOffer=${encodeURIComponent(data.rideId)}`;
    const frontendOrigin = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const deepLink = frontendOrigin ? `${frontendOrigin}${deepLinkPath}` : deepLinkPath;

    const payloadData = {
        ...data,
        type: 'NEW_RIDE',
        deepLink: deepLinkPath,
        deepLinkAbsolute: deepLink,
    };

    const options = {
        dataOnly: true,
        webpush: {
            headers: {
                Urgency: 'high',
            },
            fcmOptions: {
                link: deepLink,
            },
        },
    };

    queue.enqueue(() => sendToCaptain(captainId, title, message, 'NEW_RIDE', payloadData, options, traceId), traceId);
};

module.exports.sendNewParcel = async (captainId, data, traceId = '[AUDIT]') => {
    const fareLabel = typeof data.fare === 'number'
        ? `R$ ${data.fare.toFixed(2).replace('.', ',')}`
        : null;
    const pickupShort = shortAddress(data.pickup);
    const destShort = shortAddress(data.destination);
    const routeLabel = pickupShort && destShort
        ? `${pickupShort} → ${destShort}`
        : (pickupShort || destShort || null);
    const distanceKm = typeof data.estimatedDistance === 'number' && data.estimatedDistance > 0
        ? `${(data.estimatedDistance / 1000).toFixed(1).replace('.', ',')} km`
        : null;
    const durationMin = typeof data.estimatedTime === 'number' && data.estimatedTime > 0
        ? `${Math.max(1, Math.round(data.estimatedTime / 60))} min`
        : null;

    const title = fareLabel ? `Nova encomenda · ${fareLabel}` : 'Nova encomenda disponível';
    const message = [
        routeLabel,
        [distanceKm, durationMin].filter(Boolean).join(' · ') || null,
        data.itemName ? `Item: ${data.itemName}` : null,
        data.vehicleType,
        data.size ? `Tamanho: ${data.size}` : null,
    ].filter(Boolean).join('\n') || 'Abra o app para ver a oferta';

    const deepLinkPath = `${DEEP_LINK.captainHome}?parcelOffer=${encodeURIComponent(data.parcelId)}`;
    const frontendOrigin = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const deepLink = frontendOrigin ? `${frontendOrigin}${deepLinkPath}` : deepLinkPath;
    const payloadData = {
        ...data,
        type: 'NEW_PARCEL',
        deepLink: deepLinkPath,
        deepLinkAbsolute: deepLink,
        parcelId: data.parcelId,
    };

    queue.enqueue(() => sendToCaptain(captainId, title, message, 'NEW_PARCEL', payloadData, {
        dataOnly: true,
        webpush: {
            headers: { Urgency: 'high' },
            fcmOptions: { link: deepLink },
        },
    }, traceId), traceId);
};

// M7 da auditoria de push (2026-08-02), corrigido na auditoria final (Fase 8): o
// Service Worker não tem como saber se quem recebeu a notificação é passageiro ou
// motorista — e antes, na falta dessa informação, mandava TODO clique para
// '/captain-home'. Um passageiro tocando em "Corrida Aceita!" ia parar na tela inicial
// do motorista. O backend é quem sabe o destinatário, então manda a rota explícita.
const DEEP_LINK = {
    captainHome: '/captain-home',
    captainRiding: '/captain-riding',
    captainWallet: '/captain/wallet',
    captainProfile: '/captain/profile',
    riding: '/riding',
    home: '/home',
    scheduled: '/scheduled',
    parcelActive: '/encomenda/ativa',
};

// O painel administrativo grava o deepLink de uma campanha como um nome lógico
// ('home', 'wallet', ...) — ver notificationCampaign.model.js. O Service Worker precisa
// de uma rota real, com barra inicial: sem esta tradução, `focusOrOpenWindow('home')`
// resolveria como caminho relativo à URL do worker, não à raiz do app.
const CAMPAIGN_DEEP_LINK_ROUTE = {
    home: '/home',
    wallet: '/wallet',
    promotions: '/coupons',
    rides: '/activity',
    profile: '/profile',
};

module.exports.sendRideAccepted = async (userId, data) => {
    const title = 'Corrida Aceita!';
    const message = 'O motorista está a caminho do seu local.';
    queue.enqueue(() => sendToUser(userId, title, message, 'RIDE_ACCEPTED', { ...data, deepLink: DEEP_LINK.riding }));
};

module.exports.sendRideStarted = async (userId, data) => {
    const title = 'Corrida Iniciada!';
    const message = 'Sua corrida foi iniciada. Boa viagem!';
    queue.enqueue(() => sendToUser(userId, title, message, 'RIDE_STARTED', { ...data, deepLink: DEEP_LINK.riding }));
};

module.exports.sendRideFinished = async (userId, data) => {
    const title = 'Corrida Finalizada';
    const message = 'Sua corrida acabou. Por favor, confirme o pagamento.';
    queue.enqueue(() => sendToUser(userId, title, message, 'RIDE_FINISHED', { ...data, deepLink: DEEP_LINK.riding }));
};

// A5 da auditoria de push (2026-08-02): antes só socket ("ride-status-updated") — com o
// app em segundo plano (o cenário mais comum enquanto se espera o motorista), o
// passageiro nunca sabia que o carro tinha chegado.
module.exports.sendCaptainArrived = async (userId, data) => {
    const title = 'Seu motorista chegou!';
    const message = 'Ele está te esperando no local combinado.';
    queue.enqueue(() => sendToUser(userId, title, message, 'RIDE_ARRIVED', { ...data, deepLink: DEEP_LINK.riding }));
};

// A6 da auditoria de push (2026-08-02): antes só sendMessageToRoom('ride_<id>') — a
// sala é populada por socketId no momento do despacho, e socketId muda a cada
// reconexão; um motorista que perdeu a conexão por um instante nunca recebia o aviso.
// Só faz sentido quando a corrida já tinha um motorista específico designado.
module.exports.sendRideCancelledToCaptain = async (captainId, data) => {
    const title = 'Corrida Cancelada';
    const message = 'O passageiro cancelou a corrida.';
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'RIDE_CANCELLED', { ...data, deepLink: DEEP_LINK.captainHome }));
};

// Implementação do sistema de cancelamento (2026-08-04): o inverso de
// sendRideCancelledToCaptain — antes só existia notificação de cancelamento numa
// direção (passageiro → motorista). Quando é o motorista que desiste (a corrida volta
// pro despacho, não termina — ver cancelRideByCaptain), o passageiro ficava sem
// nenhuma notificação push, só o evento de socket (que não chega se o app estiver em
// segundo plano ou o socket tiver caído no instante exato).
module.exports.sendRideRequeuedToUser = async (userId, data) => {
    const title = 'Buscando outro motorista';
    const message = 'Seu motorista anterior não pôde continuar com a corrida. Já estamos procurando outro para você.';
    queue.enqueue(() => sendToUser(userId, title, message, 'RIDE_CANCELLED', { ...data, deepLink: DEEP_LINK.home }));
};

// --- Agendamento (Fase 3) ---

module.exports.sendScheduleCreated = async (userId, data = {}) => {
    const kindLabel = data.kind === 'parcel' ? 'encomenda' : 'corrida';
    const title = 'Agendamento confirmado';
    const message = `Sua ${kindLabel} foi agendada. Começamos a buscar motorista perto do horário.`;
    queue.enqueue(() => sendToUser(userId, title, message, 'SCHEDULE_CREATED', {
        ...data,
        deepLink: DEEP_LINK.scheduled,
    }));
};

module.exports.sendScheduleActivated = async (userId, data = {}) => {
    const kindLabel = data.kind === 'parcel' ? 'encomenda' : 'corrida';
    const title = 'Buscando motorista';
    const message = `Estamos buscando um motorista para sua ${kindLabel} agendada.`;
    const deepLink = data.kind === 'parcel' ? DEEP_LINK.parcelActive : DEEP_LINK.home;
    queue.enqueue(() => sendToUser(userId, title, message, 'SCHEDULE_ACTIVATED', {
        ...data,
        deepLink,
    }));
};

module.exports.sendScheduleNoDriver = async (userId, data = {}) => {
    const kindLabel = data.kind === 'parcel' ? 'encomenda' : 'corrida';
    const title = 'Não encontramos motorista';
    const message = data.message
        || `Não foi possível encontrar motorista para sua ${kindLabel} agendada. Você pode remarcar quando quiser.`;
    queue.enqueue(() => sendToUser(userId, title, message, 'SCHEDULE_NO_DRIVER', {
        ...data,
        deepLink: DEEP_LINK.scheduled,
    }));
};

/** Reserva o tipo no enum; cron T−30 (fase 3b) ainda não dispara. */
module.exports.sendScheduleReminder = async (userId, data = {}) => {
    const kindLabel = data.kind === 'parcel' ? 'encomenda' : 'corrida';
    const title = 'Lembrete de agendamento';
    const message = `Sua ${kindLabel} agendada está próxima. Em breve buscaremos um motorista.`;
    queue.enqueue(() => sendToUser(userId, title, message, 'SCHEDULE_REMINDER', {
        ...data,
        deepLink: DEEP_LINK.scheduled,
    }));
};

// A7 da auditoria de push (2026-08-02): chamadas quando o destinatário não está com o
// chat aberto no momento (ver socket.js) — com o chat aberto, a entrega já acontece via
// Socket.IO em tempo real e este push seria redundante.
module.exports.sendChatMessageToCaptain = async (captainId, preview, data) => {
    const deepLink = data?.subjectType === 'parcel'
        ? '/captain-parcel'
        : DEEP_LINK.captainRiding;
    queue.enqueue(() => sendToCaptain(captainId, 'Nova mensagem do passageiro', preview, 'CHAT', { ...data, deepLink }));
};

module.exports.sendChatMessageToUser = async (userId, preview, data) => {
    const deepLink = data?.subjectType === 'parcel'
        ? '/encomenda/ativa'
        : DEEP_LINK.riding;
    queue.enqueue(() => sendToUser(userId, 'Nova mensagem do motorista', preview, 'CHAT', { ...data, deepLink }));
};

// Pagamento/carteira (Fase 5 da correção do sistema de push, 2026-08-02): antes só
// socket ("payment-completed") — sem push, o motorista só sabia que o passageiro pagou
// se estivesse com o app aberto naquele instante.
module.exports.sendPaymentCompleted = async (captainId, data) => {
    const title = 'Pagamento Recebido';
    const message = 'O passageiro confirmou o pagamento da corrida.';
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'PAYMENT', { ...data, deepLink: DEEP_LINK.captainHome }));
};

module.exports.sendRechargeApproved = async (captainId, data) => {
    const title = 'Recarga Aprovada!';
    const message = 'Seus créditos foram adicionados com sucesso à sua carteira.';
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'RECHARGE', { ...data, deepLink: DEEP_LINK.captainWallet }));
};

// `sendPromotion` foi removida na auditoria final (Fase 8) — era código morto desde
// sempre (M11 da auditoria original: nunca foi chamada em lugar nenhum). Push
// promocional já é coberto, de forma melhor, pelo fluxo de campanhas: admin.controller
// .js: createPromotion cria uma NotificationCampaign espelho quando `sendPush` está
// marcado, e essa via tem segmentação, agendamento e métricas — nada disso existia aqui.

module.exports.sendAdminNotification = async (target, title, message, data = {}) => {
    try {
        const inboxService = require('./inbox.service');
        const meta = resolveMeta({
            type: data.type || 'ADMIN',
            category: data.category,
            priority: data.priority,
            icon: data.icon,
            action: data.action || data.deepLink,
            data,
        });

        // Inbox por destinatário (central in-app) + push multicast.
        const recipients = [];
        if (target === 'passengers' || target === 'all') {
            const users = await userModel.find({ isBlocked: { $ne: true } }).select('_id').lean();
            users.forEach((u) => recipients.push({ userId: u._id }));
        }
        if (target === 'drivers' || target === 'all') {
            const captains = await captainModel.find({ isBlocked: { $ne: true } }).select('_id').lean();
            captains.forEach((c) => recipients.push({ captainId: c._id }));
        }
        // Usuários específicos: data.userIds / data.captainIds
        if (Array.isArray(data.userIds)) {
            data.userIds.forEach((id) => recipients.push({ userId: id }));
        }
        if (Array.isArray(data.captainIds)) {
            data.captainIds.forEach((id) => recipients.push({ captainId: id }));
        }

        if (recipients.length > 0) {
            const created = await inboxService.createInboxNotifications({
                recipients,
                title,
                message,
                type: data.type || 'ADMIN',
                category: meta.category,
                priority: meta.priority,
                icon: meta.icon,
                action: meta.action,
                referenceId: data.referenceId,
                referenceType: data.referenceType,
                origin: 'admin',
            });
            // Tempo real para quem está online
            for (const dto of created) {
                const fakeDoc = {
                    ...dto,
                    _id: dto.id,
                    userId: dto.userId,
                    captainId: dto.captainId,
                    message: dto.message,
                    read: false,
                };
                emitInboxRealtime(fakeDoc).catch(() => {});
            }
        }

        let tokens = [];
        if (target === 'passengers' || target === 'all') {
            tokens.push(...await tokenRegistry.getAllPassengerTokens());
        }
        if (target === 'drivers' || target === 'all') {
            tokens.push(...await tokenRegistry.getAllDriverTokens());
        }
        if (Array.isArray(data.userIds)) {
            for (const uid of data.userIds) {
                tokens.push(...await tokenRegistry.getTokensForUser(uid));
            }
        }
        if (Array.isArray(data.captainIds)) {
            for (const cid of data.captainIds) {
                tokens.push(...await tokenRegistry.getTokensForCaptain(cid));
            }
        }
        // Dedupe defensivo: mesmo com a segmentação corrigida (C4), nenhum dispositivo
        // deve receber a mesma notificação duas vezes.
        const uniqueTokens = [...new Set(tokens)];
        if (uniqueTokens.length > 0) {
            await pushTransport.sendPush(
                uniqueTokens,
                { title, message, data: { ...data, type: data.type || 'ADMIN', deepLink: meta.action } },
                '[ADMIN]'
            );
        }
    } catch (error) {
        console.error('[Notification] Erro ao enviar notificação administrativa:', error);
    }
};

// Fase 7 da correção do sistema de push (2026-08-02): canal de push para o painel
// administrativo. Sempre broadcast pra todos os admins com token registrado — não
// direcionado a um admin específico, mesmo padrão de sendAdminNotification acima
// (o próprio painel não tem hoje o conceito de "admin de plantão").
const sendAdminAlertNow = async (title, message, data = {}) => {
    try {
        const tokens = await tokenRegistry.getAllAdminTokens();
        await recordAndSend({ title, message, type: 'ADMIN', targetAudience: 'admins' }, tokens, { title, message, data });
    } catch (error) {
        console.error('[Notification] Erro ao enviar alerta para o painel administrativo:', error);
    }
};

module.exports.sendAdminAlert = async (title, message, data = {}) => {
    queue.enqueue(() => sendAdminAlertNow(title, message, data));
};

module.exports.sendNewCaptainAlert = async (captainName) => {
    module.exports.sendAdminAlert(
        'Novo motorista aguardando aprovação',
        `${captainName} acabou de se cadastrar e está aguardando revisão de documentos.`
    );
};

// Simplificação do cadastro do motorista (2026-08-04): a documentação deixou de
// bloquear o cadastro inicial, então o motorista precisa ser avisado — logo na hora e
// depois, se o prazo estiver terminando ou tiver terminado — de que ainda precisa
// resolver isso pra poder ficar online. Ver captainDeadline.service.js (cron) e
// admin.service.js (aprovação/rejeição por documento).
const formatDeadlineDate = (deadline) => {
    try {
        return new Date(deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
        return '';
    }
};

module.exports.sendCaptainRegistered = async (captainId, data) => {
    const title = 'Cadastro realizado!';
    const message = `Envie seus documentos até ${formatDeadlineDate(data.documentDeadline)} para concluir a ativação da sua conta.`;
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'DOCUMENT', { ...data, deepLink: DEEP_LINK.captainProfile }));
};

module.exports.sendDocumentDeadlineReminder = async (captainId, data) => {
    const title = 'Seu prazo está terminando';
    const message = `Você tem até ${formatDeadlineDate(data.documentDeadline)} para enviar seus documentos e não perder o acesso.`;
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'DOCUMENT', { ...data, deepLink: DEEP_LINK.captainProfile }));
};

module.exports.sendDocumentDeadlineExpired = async (captainId, data) => {
    const title = 'Prazo de documentação expirado';
    const message = 'O prazo para enviar seus documentos expirou. Envie agora para reativar sua conta.';
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'DOCUMENT', { ...data, deepLink: DEEP_LINK.captainProfile }));
};

module.exports.sendCaptainApproved = async (captainId, data = {}) => {
    const title = 'Cadastro aprovado!';
    const message = 'Sua documentação foi aprovada. Você já pode ficar online e receber corridas.';
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'DOCUMENT', { ...data, deepLink: DEEP_LINK.captainHome }));
};

module.exports.sendCaptainRejected = async (captainId, data = {}) => {
    const title = 'Cadastro reprovado';
    const message = data.reason
        ? `Sua documentação foi reprovada: ${data.reason}. Envie novamente para continuar.`
        : 'Sua documentação foi reprovada. Verifique o motivo no app e envie novamente.';
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'DOCUMENT', { ...data, deepLink: DEEP_LINK.captainProfile }));
};

module.exports.sendDocumentApproved = async (captainId, data) => {
    const title = 'Documento aprovado';
    const message = `Seu documento (${data.docLabel}) foi aprovado.`;
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'DOCUMENT', { ...data, deepLink: DEEP_LINK.captainProfile }));
};

module.exports.sendDocumentRejected = async (captainId, data) => {
    const title = 'Um documento precisa ser reenviado';
    const message = data.reason
        ? `${data.docLabel}: ${data.reason}`
        : `Seu documento (${data.docLabel}) foi rejeitado. Envie novamente.`;
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'DOCUMENT', { ...data, deepLink: DEEP_LINK.captainProfile }));
};

module.exports.sendComplaintAlert = async (rideId, issueCategory) => {
    module.exports.sendAdminAlert(
        'Denúncia registrada em uma corrida',
        `Categoria: ${issueCategory}. Corrida ${rideId}.`,
        { rideId, issueCategory }
    );
};

module.exports.sendPaymentProblemAlert = async (description) => {
    module.exports.sendAdminAlert('Problema de pagamento', description);
};

// CAMPAIGNS LOGIC

const buildTargetQuery = (targetRules) => {
    const query = {};
    if (targetRules.isBlocked !== undefined) query.isBlocked = targetRules.isBlocked;
    if (targetRules.city) query.city = { $regex: targetRules.city, $options: 'i' };
    if (targetRules.state) query.state = { $regex: targetRules.state, $options: 'i' };

    if (targetRules.audienceType === 'passengers') {
        if (targetRules.isVIP !== undefined && targetRules.isVIP) query.tags = 'VIP';
        if (targetRules.noRidesDays) {
            const date = new Date();
            date.setDate(date.getDate() - targetRules.noRidesDays);
            query.lastRideAt = { $lt: date };
        }
    } else if (targetRules.audienceType === 'drivers') {
        if (targetRules.isOnline !== undefined) query.status = targetRules.isOnline ? 'active' : 'inactive';
        if (targetRules.vehicleType) query['vehicle.vehicleType'] = targetRules.vehicleType;
    }
    return query;
};

module.exports.calculateAudience = async (targetRules) => {
    const query = buildTargetQuery(targetRules);
    let count = 0;

    if (targetRules.audienceType === 'all') {
        count += await userModel.countDocuments(query);
        count += await captainModel.countDocuments(query);
    } else if (targetRules.audienceType === 'passengers') {
        count = await userModel.countDocuments(query);
    } else if (targetRules.audienceType === 'drivers') {
        count = await captainModel.countDocuments(query);
    }
    return count;
};

module.exports.processCampaign = async (campaignId) => {
    // M1 da auditoria de push (2026-08-02): findById + save() separado não é atômico —
    // com duas instâncias do backend rodando, ou o cron dessa mesma instância disparando
    // de novo antes do processamento anterior terminar, as duas liam status:'scheduled'
    // antes de qualquer uma escrever 'processing', e a campanha era enviada duas vezes.
    // findOneAndUpdate com o status de origem no filtro (mesmo padrão de
    // rideService.acceptRideAtomic) garante que só uma chamada "vence".
    const campaign = await NotificationCampaign.findOneAndUpdate(
        { _id: campaignId, status: 'scheduled' },
        { $set: { status: 'processing' } },
        { new: true }
    );
    if (!campaign) return;

    try {
        const query = buildTargetQuery(campaign.targetRules);
        let tokens = [];

        if (campaign.targetRules.audienceType === 'all' || campaign.targetRules.audienceType === 'passengers') {
            const users = await userModel.find(query).select('_id');
            tokens.push(...await tokenRegistry.getTokensForUsers(users.map(u => u._id)));
        }

        if (campaign.targetRules.audienceType === 'all' || campaign.targetRules.audienceType === 'drivers') {
            const captains = await captainModel.find(query).select('_id');
            tokens.push(...await tokenRegistry.getTokensForCaptains(captains.map(c => c._id)));
        }

        const uniqueTokens = [...new Set(tokens)];

        if (uniqueTokens.length > 0) {
            // M2 da auditoria de push (2026-08-02): pushTransport.sendPush já faz o
            // chunking de 500 internamente — antes, chamar getMessaging() direto aqui
            // fazia uma campanha com mais de 500 destinatários falhar por inteiro.
            const result = await pushTransport.sendPush(uniqueTokens, {
                title: campaign.title,
                message: campaign.message,
                image: campaign.imageUrl || undefined,
                data: { type: campaign.type, deepLink: CAMPAIGN_DEEP_LINK_ROUTE[campaign.deepLink] || DEEP_LINK.home }
            }, `[Campaign:${campaign._id}]`);

            campaign.metrics.sent = uniqueTokens.length;
            campaign.metrics.delivered = result.successCount;
            campaign.metrics.failed = result.failureCount;

            if (result.invalidTokens.length > 0) {
                await tokenRegistry.removeInvalidTokens(result.invalidTokens);
            }
        }

        campaign.status = 'completed';
        await campaign.save();
    } catch (error) {
        console.error('Error processing campaign:', error);
        campaign.status = 'failed';
        campaign.errorLog = error.message;
        await campaign.save();
    }
};

// Cron das campanhas agendadas (roda a cada minuto).
cron.schedule('* * * * *', async () => {
    try {
        const pendingCampaigns = await NotificationCampaign.find({
            status: 'scheduled',
            scheduledAt: { $lte: new Date() }
        });

        for (const campaign of pendingCampaigns) {
            await module.exports.processCampaign(campaign._id);
        }
    } catch (e) {
        console.error('Cron job error:', e);
    }
});
