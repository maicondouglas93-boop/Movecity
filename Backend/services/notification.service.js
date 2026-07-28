const { getMessaging } = require('firebase-admin/messaging');
const Notification = require('../models/notification.model');
const NotificationToken = require('../models/notificationToken.model');

const sendPush = async (tokens, payload) => {
    if (!tokens || tokens.length === 0) return;
    try {
        const message = {
            notification: {
                title: payload.title,
                body: payload.message
            },
            data: payload.data || {},
            tokens: tokens
        };
        const response = await getMessaging().sendEachForMulticast(message);
        console.log('Firebase Push enviado:', response.successCount, 'sucesso,', response.failureCount, 'falhas');
    } catch (error) {
        console.error('Erro ao enviar Push Notification:', error);
    }
}

const sendToUser = async (userId, title, message, type, data = {}) => {
    // Save to DB
    await Notification.create({ userId, title, message, type, status: 'sent', sentAt: new Date(), targetAudience: 'specific' });

    // Get Tokens
    const userTokens = await NotificationToken.find({ userId });
    const tokens = userTokens.map(t => t.token);

    // Send Push
    await sendPush(tokens, { title, message, data });
}

const sendToCaptain = async (captainId, title, message, type, data = {}) => {
    // Save to DB
    await Notification.create({ captainId, title, message, type, status: 'sent', sentAt: new Date(), targetAudience: 'specific' });

    // Get Tokens
    const captainTokens = await NotificationToken.find({ captainId });
    const tokens = captainTokens.map(t => t.token);

    // Send Push
    await sendPush(tokens, { title, message, data });
}

module.exports.sendNewRide = async (captainId, data) => {
    const title = 'Nova Corrida Disponível!';
    const message = 'Há um passageiro solicitando uma corrida perto de você.';
    await sendToCaptain(captainId, title, message, 'NEW_RIDE', data);
}

module.exports.sendRideAccepted = async (userId, data) => {
    const title = 'Corrida Aceita!';
    const message = 'O motorista está a caminho do seu local.';
    await sendToUser(userId, title, message, 'RIDE_ACCEPTED', data);
}

module.exports.sendRideStarted = async (userId, data) => {
    const title = 'Corrida Iniciada!';
    const message = 'Sua corrida foi iniciada. Boa viagem!';
    await sendToUser(userId, title, message, 'RIDE_STARTED', data);
}

module.exports.sendRideFinished = async (userId, data) => {
    const title = 'Corrida Finalizada';
    const message = 'Sua corrida acabou. Por favor, confirme o pagamento.';
    await sendToUser(userId, title, message, 'RIDE_FINISHED', data);
}

module.exports.sendRechargeApproved = async (captainId, data) => {
    const title = 'Recarga Aprovada!';
    const message = 'Seus créditos foram adicionados com sucesso à sua carteira.';
    await sendToCaptain(captainId, title, message, 'RECHARGE', data);
}

module.exports.sendPromotion = async (userId, data) => {
    const title = 'Nova Promoção!';
    const message = 'Aproveite nosso novo cupom de desconto em sua próxima viagem.';
    await sendToUser(userId, title, message, 'PROMOTION', data);
}

module.exports.sendAdminNotification = async (target, title, message, data = {}) => {
    await Notification.create({ title, message, type: 'ADMIN', status: 'sent', sentAt: new Date(), targetAudience: target });
    
    let tokens = [];
    if (target === 'passengers' || target === 'all') {
        const userTokens = await NotificationToken.find({ userId: { $exists: true } });
        tokens.push(...userTokens.map(t => t.token));
    }
    if (target === 'drivers' || target === 'all') {
        const captainTokens = await NotificationToken.find({ captainId: { $exists: true } });
        tokens.push(...captainTokens.map(t => t.token));
    }

    await sendPush(tokens, { title, message, data });
}
