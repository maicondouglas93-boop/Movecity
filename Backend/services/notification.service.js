const { getMessaging } = require('firebase-admin/messaging');
const Notification = require('../models/notification.model');
const NotificationToken = require('../models/notificationToken.model');
const NotificationCampaign = require('../models/notificationCampaign.model');
const userModel = require('../models/user.model');
const captainModel = require('../models/captain.model');
const cron = require('node-cron');

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

// CAMPAIGNS LOGIC

const buildTargetQuery = (targetRules) => {
    const query = {};
    if (targetRules.isBlocked !== undefined) query.isBlocked = targetRules.isBlocked;
    if (targetRules.city) query.city = { $regex: targetRules.city, $options: 'i' };
    if (targetRules.state) query.state = { $regex: targetRules.state, $options: 'i' };

    if (targetRules.audienceType === 'passengers') {
        if (targetRules.isVIP !== undefined && targetRules.isVIP) query.tags = 'VIP';
        // if (targetRules.hasCoupon) query.coupon = ...
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
    const campaign = await NotificationCampaign.findById(campaignId);
    if (!campaign || campaign.status !== 'scheduled') return;

    campaign.status = 'processing';
    await campaign.save();

    try {
        const query = buildTargetQuery(campaign.targetRules);
        let tokens = [];

        if (campaign.targetRules.audienceType === 'all' || campaign.targetRules.audienceType === 'passengers') {
            const users = await userModel.find(query).select('_id fullname');
            const userIds = users.map(u => u._id);
            const userTokens = await NotificationToken.find({ userId: { $in: userIds } });
            
            // Aqui poderia haver substituição de variáveis tipo {{nome}} se fizéssemos envio individual
            tokens.push(...userTokens.map(t => t.token));
        }

        if (campaign.targetRules.audienceType === 'all' || campaign.targetRules.audienceType === 'drivers') {
            const captains = await captainModel.find(query).select('_id fullname');
            const captainIds = captains.map(c => c._id);
            const captainTokens = await NotificationToken.find({ captainId: { $in: captainIds } });
            tokens.push(...captainTokens.map(t => t.token));
        }

        // Send Push
        if (tokens.length > 0) {
            const messagePayload = {
                notification: {
                    title: campaign.title,
                    body: campaign.message,
                    ...(campaign.imageUrl && { image: campaign.imageUrl })
                },
                data: {
                    type: campaign.type,
                    deepLink: campaign.deepLink || 'home'
                },
                tokens: tokens
            };
            
            const response = await getMessaging().sendEachForMulticast(messagePayload);
            
            campaign.metrics.sent = tokens.length;
            campaign.metrics.delivered = response.successCount;
            campaign.metrics.failed = response.failureCount;
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

// Start Cron Job for Scheduled Campaigns (Runs every minute)
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
