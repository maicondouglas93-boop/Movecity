const Notification = require('../models/notification.model');
const NotificationCampaign = require('../models/notificationCampaign.model');
const userModel = require('../models/user.model');
const captainModel = require('../models/captain.model');
const cron = require('node-cron');
const tokenRegistry = require('./tokenRegistry.service');
const pushTransport = require('./pushTransport.service');
const queue = require('./queue.service');

// Extraído de services/notification.service.js (Fase 4 da correção do sistema de push,
// 2026-08-02). Responsabilidade: decidir quem recebe o quê, gravar o histórico
// (Notification/NotificationCampaign) e delegar o envio de fato ao pushTransport.

// M4 da auditoria de push (2026-08-02): antes gravava status:'sent' incondicionalmente,
// antes mesmo de tentar enviar — o histórico afirmava uma entrega que podia nunca ter
// acontecido. Agora grava 'sending', tenta enviar, e só então grava o resultado real.
const recordAndSend = async (notificationData, tokens, payload, traceId = '[AUDIT]') => {
    const notification = await Notification.create({ ...notificationData, status: 'sending', sentAt: new Date() });
    const result = await pushTransport.sendPush(tokens, payload, traceId);

    notification.status = (tokens.length === 0 || result.successCount > 0) ? 'sent' : 'failed';
    await notification.save();

    if (result.invalidTokens.length > 0) {
        await tokenRegistry.removeInvalidTokens(result.invalidTokens);
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

module.exports.sendNewRide = async (captainId, data, traceId = '[AUDIT]') => {
    const title = 'Nova Corrida Disponível!';
    const message = 'Há um passageiro solicitando uma corrida perto de você.';

    // C2 da auditoria de push (2026-08-02): o fallback antigo apontava pra
    // localhost:4000 — uma porta que nem o próprio backend usa (PORT default é 3000,
    // ver server.js) — e sem BASE_URL configurado em produção o Service Worker do
    // motorista tentava aceitar a corrida contra o próprio dispositivo dele.
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl && process.env.NODE_ENV === 'production') {
        console.error('[Notification] AVISO CRÍTICO: BASE_URL não configurado em produção — o botão "Aceitar" da notificação push do motorista vai falhar.');
    }
    data.apiUrl = baseUrl || `http://localhost:${process.env.PORT || 3000}`;
    data.deepLink = DEEP_LINK.captainHome;

    // Auditoria final (Fase 8): sem BASE_URL em produção, o "Aceitar" não tem como
    // funcionar (apontaria pro localhost do próprio celular do motorista). Melhor não
    // oferecer o botão do que oferecer um que falha em silêncio — a notificação continua
    // chegando normalmente, só sem a ação embutida, e o motorista abre o app pra aceitar.
    const canAcceptInline = !!baseUrl || process.env.NODE_ENV !== 'production';

    const options = {
        webpush: {
            notification: {
                ...(canAcceptInline ? {
                    actions: [
                        { action: 'accept', title: '✅ Aceitar' },
                        { action: 'reject', title: '❌ Recusar' },
                        { action: 'open', title: '📱 Abrir App' }
                    ]
                } : {}),
                requireInteraction: true
            },
            fcmOptions: {
                link: DEEP_LINK.captainHome
            }
        }
    };

    // M3 da auditoria de push (2026-08-02): enfileirado em vez de aguardado — o
    // despacho de uma corrida não deve esperar (nem depender de) o resultado do envio.
    queue.enqueue(() => sendToCaptain(captainId, title, message, 'NEW_RIDE', data, options, traceId), traceId);
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
    riding: '/riding',
    home: '/home',
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

// A7 da auditoria de push (2026-08-02): chamadas quando o destinatário não está com o
// chat aberto no momento (ver socket.js) — com o chat aberto, a entrega já acontece via
// Socket.IO em tempo real e este push seria redundante.
module.exports.sendChatMessageToCaptain = async (captainId, preview, data) => {
    queue.enqueue(() => sendToCaptain(captainId, 'Nova mensagem do passageiro', preview, 'CHAT', { ...data, deepLink: DEEP_LINK.captainRiding }));
};

module.exports.sendChatMessageToUser = async (userId, preview, data) => {
    queue.enqueue(() => sendToUser(userId, 'Nova mensagem do motorista', preview, 'CHAT', { ...data, deepLink: DEEP_LINK.riding }));
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
        let tokens = [];
        if (target === 'passengers' || target === 'all') {
            tokens.push(...await tokenRegistry.getAllPassengerTokens());
        }
        if (target === 'drivers' || target === 'all') {
            tokens.push(...await tokenRegistry.getAllDriverTokens());
        }
        // Dedupe defensivo: mesmo com a segmentação corrigida (C4), nenhum dispositivo
        // deve receber a mesma notificação duas vezes.
        const uniqueTokens = [...new Set(tokens)];

        await recordAndSend({ title, message, type: 'ADMIN', targetAudience: target }, uniqueTokens, { title, message, data });
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
