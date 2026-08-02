const adminService = require('../services/admin.service');

module.exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const { admin, token, refreshToken } = await adminService.login(email, password);

        res.cookie('adminToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 15 * 60 * 1000 // 15 minutes
        });

        res.status(200).json({
            message: 'Logged in successfully',
            admin: {
                _id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
            },
            token,
            refreshToken
        });
    } catch (error) {
        if (error.message === 'Invalid email or password' || error.message === 'Admin account is deactivated') {
            return res.status(401).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.refresh = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        const { admin, token, refreshToken: newRefreshToken } = await adminService.refreshAccessToken(refreshToken);

        res.cookie('adminToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 15 * 60 * 1000 // 15 minutes
        });

        res.status(200).json({
            admin: {
                _id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
            },
            token,
            refreshToken: newRefreshToken
        });
    } catch (error) {
        return res.status(401).json({ message: error.message || 'Refresh token inválido' });
    }
};

module.exports.logout = async (req, res, next) => {
    try {
        if (req.admin) {
            await adminService.invalidateRefreshToken(req.admin._id);
        }
        res.clearCookie('adminToken');
        res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports.getDashboard = async (req, res, next) => {
    try {
        const { period } = req.query;
        const stats = await adminService.getDashboardStats(period || 'today');
        res.status(200).json(stats);
    } catch (error) {
        next(error);
    }
};

module.exports.getHealthStatus = async (req, res, next) => {
    try {
        const start = Date.now();
        const health = await adminService.getHealthStatus();
        const latency = Date.now() - start;
        health.latency = latency;
        res.status(200).json(health);
    } catch (error) {
        next(error);
    }
};

module.exports.getUsers = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, search = '', status, city, hasRides, dateRange, sortBy, sortOrder } = req.query;
        const result = await adminService.getUsers(Number(page), Number(limit), search, { status, city, hasRides, dateRange, sortBy, sortOrder });
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getUserDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getUserDetails(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.toggleUserBlock = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isBlocked, reason } = req.body;
        const user = await adminService.toggleUserBlock(id, isBlocked, reason, req.admin, req.ip);
        
        const auditService = require('../services/audit.service');
        await auditService.logAction(req.admin._id, 'UPDATE', 'User', id, { isBlocked, reason }, req.ip);
        
        res.status(200).json(user);
    } catch (error) {
        next(error);
    }
};

module.exports.bulkActionUsers = async (req, res, next) => {
    try {
        const { userIds, actionType, reason } = req.body;
        const result = await adminService.bulkActionUsers(userIds, actionType, reason, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.updateUserTags = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { tags } = req.body;
        const result = await adminService.updateUserTags(id, tags, req.admin);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.addUserObservation = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { text } = req.body;
        const result = await adminService.addUserObservation(id, text, req.admin);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.sendNotification = async (req, res, next) => {
    try {
        const { target, title, message, data } = req.body;
        const notificationService = require('../services/notification.service');
        await notificationService.sendAdminNotification(target, title, message, data);
        res.status(200).json({ message: 'Notificação enviada com sucesso' });
    } catch (error) {
        next(error);
    }
};

module.exports.createCampaign = async (req, res, next) => {
    try {
        const { title, message, imageUrl, deepLink, type, targetRules, scheduledAt } = req.body;
        const NotificationCampaign = require('../models/notificationCampaign.model');
        
        const campaign = new NotificationCampaign({
            title, message, imageUrl, deepLink, type, targetRules,
            adminId: req.admin._id,
            status: scheduledAt ? 'scheduled' : 'draft',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null
        });
        
        await campaign.save();

        if (!scheduledAt) {
            // Process immediately if no date
            campaign.status = 'scheduled';
            campaign.scheduledAt = new Date();
            await campaign.save();
            // We could call processCampaign right away, but the cron will pick it up instantly.
            // Or we can just call it to be synchronous enough.
            const notificationService = require('../services/notification.service');
            notificationService.processCampaign(campaign._id).catch(console.error);
        }

        res.status(201).json(campaign);
    } catch (error) {
        next(error);
    }
};

module.exports.getCampaigns = async (req, res, next) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const NotificationCampaign = require('../models/notificationCampaign.model');
        const skip = (page - 1) * limit;
        
        const campaigns = await NotificationCampaign.find()
            .populate('adminId', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit));
            
        const total = await NotificationCampaign.countDocuments();
        
        res.status(200).json({ campaigns, total, pages: Math.ceil(total / limit) });
    } catch (error) {
        next(error);
    }
};

module.exports.estimateAudience = async (req, res, next) => {
    try {
        const { targetRules } = req.body;
        const notificationService = require('../services/notification.service');
        const count = await notificationService.calculateAudience(targetRules);
        res.status(200).json({ count });
    } catch (error) {
        next(error);
    }
};

module.exports.cancelCampaign = async (req, res, next) => {
    try {
        const { id } = req.params;
        const NotificationCampaign = require('../models/notificationCampaign.model');
        const campaign = await NotificationCampaign.findById(id);
        
        if (!campaign || campaign.status !== 'scheduled') {
            return res.status(400).json({ message: 'Apenas campanhas agendadas podem ser canceladas' });
        }
        
        campaign.status = 'cancelled';
        await campaign.save();
        res.status(200).json(campaign);
    } catch (error) {
        next(error);
    }
};

// PROMOTIONS ENGINE
module.exports.createPromotion = async (req, res, next) => {
    try {
        const Promotion = require('../models/promotion.model');
        const data = req.body;
        
        data.auditLogs = [{
            adminId: req.admin._id,
            adminName: req.admin.name || 'Admin',
            action: 'created',
            details: 'Campanha criada'
        }];

        const promotion = new Promotion(data);
        await promotion.save();

        const auditService = require('../services/audit.service');
        await auditService.logAction(req.admin._id, 'CREATE', 'Promotion', promotion._id, { title: data.title, code: data.code }, req.ip);

        if (data.sendPush) {
            // Se tiver integração com Push, cria uma campanha NotificationCampaign espelho
            const NotificationCampaign = require('../models/notificationCampaign.model');
            await NotificationCampaign.create({
                title: data.title,
                message: data.description || 'Nova promoção ativada para você!',
                imageUrl: data.bannerImage,
                deepLink: 'promotions',
                type: 'promotion',
                targetRules: { audienceType: 'all' }, // Simplificado para o demo
                adminId: req.admin._id,
                status: 'scheduled',
                scheduledAt: data.startDate || new Date()
            });
        }

        res.status(201).json(promotion);
    } catch (error) {
        next(error);
    }
};

module.exports.getPromotions = async (req, res, next) => {
    try {
        const Promotion = require('../models/promotion.model');
        const promotions = await Promotion.find().sort({ createdAt: -1 });
        res.status(200).json({ promotions });
    } catch (error) {
        next(error);
    }
};

module.exports.updatePromotionStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const Promotion = require('../models/promotion.model');
        
        const promotion = await Promotion.findById(id);
        if (!promotion) return res.status(404).json({ message: 'Promoção não encontrada' });

        promotion.status = status;
        promotion.auditLogs.push({
            adminId: req.admin._id,
            adminName: req.admin.name || 'Admin',
            action: 'updated_status',
            details: `Status alterado para ${status}`
        });

        await promotion.save();
        res.status(200).json(promotion);
    } catch (error) {
        next(error);
    }
};

module.exports.simulatePromotion = async (req, res, next) => {
    try {
        const { rideValue, promotionData } = req.body;
        let discount = 0;

        if (promotionData.discountType === 'percentage') {
            discount = rideValue * (promotionData.value / 100);
            if (promotionData.maxDiscountLimit && discount > promotionData.maxDiscountLimit) {
                discount = promotionData.maxDiscountLimit;
            }
        } else if (promotionData.discountType === 'fixed') {
            discount = promotionData.value;
        } else if (promotionData.discountType === 'free_ride') {
            discount = rideValue;
            if (promotionData.maxDiscountLimit && discount > promotionData.maxDiscountLimit) {
                discount = promotionData.maxDiscountLimit;
            }
        }

        const clientPays = Math.max(0, rideValue - discount);
        const subsidy = rideValue - clientPays;

        res.status(200).json({
            rideValue,
            clientPays,
            subsidy,
            discountApplied: discount
        });
    } catch (error) {
        next(error);
    }
};

// BUSINESS INTELLIGENCE (REPORTS)
module.exports.getReportDashboard = async (req, res, next) => {
    try {
        const reportService = require('../services/report.service');
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) return res.status(400).json({ message: 'Datas obrigatórias' });

        const dashboard = await reportService.getExecutiveDashboard(startDate, endDate);
        res.status(200).json(dashboard);
    } catch (error) {
        next(error);
    }
};

module.exports.getReportCharts = async (req, res, next) => {
    try {
        const reportService = require('../services/report.service');
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) return res.status(400).json({ message: 'Datas obrigatórias' });

        const charts = await reportService.getChartsData(startDate, endDate);
        res.status(200).json(charts);
    } catch (error) {
        next(error);
    }
};

module.exports.getReportRankings = async (req, res, next) => {
    try {
        const reportService = require('../services/report.service');
        const { startDate, endDate, limit } = req.query;
        
        if (!startDate || !endDate) return res.status(400).json({ message: 'Datas obrigatórias' });

        const rankings = await reportService.getRankings(startDate, endDate, limit);
        res.status(200).json(rankings);
    } catch (error) {
        next(error);
    }
};

module.exports.exportReportCSV = async (req, res, next) => {
    try {
        const reportService = require('../services/report.service');
        const { type } = req.params;
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) return res.status(400).json({ message: 'Datas obrigatórias' });

        let csvData = "";
        
        if (type === 'financial') {
            const data = await reportService.getChartsData(startDate, endDate);
            csvData = "Data,Receita(R$),Corridas\n";
            data.revenueChart.forEach(row => {
                csvData += `${row._id},${row.revenue},${row.rides}\n`;
            });
        } else if (type === 'passengers' || type === 'captains') {
            const rankings = await reportService.getRankings(startDate, endDate, 100);
            csvData = "Nome,Corridas,Valor\n";
            const target = type === 'passengers' ? rankings.topPassengers : rankings.topCaptains;
            target.forEach(row => {
                csvData += `${row.name},${row.rides},${row.amount}\n`;
            });
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=export_${type}_${Date.now()}.csv`);
        res.status(200).send(csvData);
    } catch (error) {
        next(error);
    }
};

module.exports.getCaptains = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;
        const result = await adminService.getCaptains(Number(page), Number(limit), search);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.updateCaptainApproval = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { approvalStatus, reason } = req.body;
        const result = await adminService.updateCaptainApproval(id, approvalStatus, reason, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.toggleCaptainBlock = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isBlocked, reason } = req.body;
        const result = await adminService.toggleCaptainBlock(id, isBlocked, reason, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getCaptainDocuments = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getCaptainDocuments(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getCaptainDocumentUrl = async (req, res, next) => {
    try {
        const { id, docType } = req.params;
        const url = await adminService.getCaptainDocumentSignedUrl(id, docType);
        res.status(200).json({ url });
    } catch (error) {
        next(error);
    }
};

module.exports.updateCaptainDocument = async (req, res, next) => {
    try {
        const { id, docType } = req.params;
        const { verified, reason } = req.body;
        const result = await adminService.updateCaptainDocument(id, docType, verified, reason, req.admin);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getCaptainRecentRides = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getCaptainRecentRides(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getCaptainWallet = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getCaptainWallet(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.adjustCaptainWallet = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { amount, type, reason } = req.body;
        const result = await adminService.adjustCaptainWallet(id, amount, type, reason, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getCaptainTimeline = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getCaptainTimeline(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getRides = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, search = '', status, vehicleType, paymentMethod, period } = req.query;
        const result = await adminService.getRides(Number(page), Number(limit), search, { status, vehicleType, paymentMethod, period });
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.cancelRide = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const result = await adminService.cancelRide(id, reason, req.admin);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.reassignRide = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { ride, previousCaptain } = await adminService.reassignRide(id, req.admin, req.ip);

        // Bloco E (2026-08-02): antes disto, ninguém era avisado da reatribuição — nem o
        // motorista removido (continuava vendo a corrida como sua até o próximo refresh),
        // nem outros motoristas (a corrida voltava a 'requested' mas não era redespachada).
        const { sendMessageToRoom } = require('../socket');
        sendMessageToRoom(`ride_${ride._id}`, {
            event: 'ride-reassigned-by-admin',
            data: { rideId: ride._id }
        });

        const { dispatchRideToCaptains } = require('./ride.controller');
        await dispatchRideToCaptains(ride, {
            pickup: ride.pickup,
            vehicleType: ride.vehicleType,
            TRACE_ID: `Ride:${ride._id}:AdminReassign`,
            excludeCaptainId: previousCaptain
        });

        res.status(200).json(ride);
    } catch (error) {
        if (error.message === 'Corrida não encontrada') {
            return res.status(404).json({ message: error.message });
        }
        if (error.message.includes('não pode ser reatribuída')) {
            return res.status(409).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.bulkActionRides = async (req, res, next) => {
    try {
        const { rideIds, actionType, reason } = req.body;
        const result = await adminService.bulkActionRides(rideIds, actionType, reason, req.admin);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getPayouts = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, status, period, search } = req.query;
        const result = await adminService.getPayouts(Number(page), Number(limit), { status, period, search });
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getPayoutDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getPayoutDetails(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.approvePayout = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.approvePayout(id, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        // Erros de regra de negócio (saldo insuficiente, corrida perdida pro CAS, motorista
        // bloqueado etc.) precisam do err.message de verdade — em produção, next(error) cairia
        // no handler global e viraria "Internal Server Error" genérico (ver app.js), escondendo
        // exatamente a mensagem que o admin precisa ver.
        res.status(400).json({ message: error.message });
    }
};

module.exports.confirmPayoutPaid = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.confirmPayoutPaid(id, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports.rejectPayout = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const result = await adminService.rejectPayout(id, reason, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports.bulkApprovePayouts = async (req, res, next) => {
    try {
        const { payoutIds } = req.body;
        const result = await adminService.bulkApprovePayouts(payoutIds, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getCaptainFinancialHistory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getCaptainFinancialHistory(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getTariffs = async (req, res, next) => {
    try {
        const result = await adminService.getTariffs();
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.updateTariff = async (req, res, next) => {
    try {
        const data = req.body;
        // In the new route structure, we only have one global settings document, so we might just take the first one or pass a generic ID
        const tariff = await adminService.updateGlobalSettings(data);
        
        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'update_tariff',
            targetId: tariff._id.toString(),
            targetModel: 'TariffSetting',
            reason: 'Atualização de configurações globais',
            newValue: data,
            ipAddress: req.ip
        });
        
        res.status(200).json(tariff);
    } catch (error) {
        // Bloco E (2026-08-02, achado C1): conflito de edição concorrente — nosso próprio
        // erro marcado (err.statusCode) ou o VersionError nativo do Mongoose no caso raro
        // de dois PUTs colidindo dentro da janela entre a pré-checagem e o save().
        if (error.statusCode === 409 || error.name === 'VersionError') {
            return res.status(409).json({ message: error.statusCode === 409 ? error.message : 'As configurações foram alteradas por outro administrador enquanto você editava. Recarregue a página para ver os valores atuais antes de salvar.' });
        }
        next(error);
    }
};

module.exports.getVehicleCategories = async (req, res, next) => {
    try {
        const result = await adminService.getVehicleCategories();
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.createVehicleCategory = async (req, res, next) => {
    try {
        const category = await adminService.createVehicleCategory(req.body);

        const tariffHistoryModel = require('../models/tariffHistory.model');
        await tariffHistoryModel.create({
            admin: req.admin.name || req.admin.email,
            ip: req.ip,
            browser: req.headers['user-agent'],
            action: 'create',
            entity: 'VehicleCategory',
            categoryId: category._id,
            newValue: req.body,
            reason: `Categoria criada: ${category.displayName}`
        });

        res.status(201).json(category);
    } catch (error) {
        next(error);
    }
};

module.exports.updateVehicleCategory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const { category, oldValue } = await adminService.updateVehicleCategory(id, data);
        
        const tariffHistoryModel = require('../models/tariffHistory.model');
        await tariffHistoryModel.create({
            admin: req.admin.name || req.admin.email,
            ip: req.ip,
            browser: req.headers['user-agent'],
            action: 'update',
            entity: 'VehicleCategory',
            oldValue: oldValue,
            newValue: data,
            categoryId: category._id,
            reason: `Atualização de tarifas da categoria: ${category.displayName}`
        });
        
        res.status(200).json(category);
    } catch (error) {
        if (error.statusCode === 409) {
            return res.status(409).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.getLogs = async (req, res, next) => {
    try {
        const { page = 1, limit = 15 } = req.query;
        const result = await adminService.getLogs(Number(page), Number(limit));
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getTariffHistory = async (req, res, next) => {
    try {
        const { categoryId, limit = 10 } = req.query;
        const query = {};
        if (categoryId) {
            query.categoryId = categoryId;
        } else {
            query.entity = 'TariffSetting';
        }
        
        const tariffHistoryModel = require('../models/tariffHistory.model');
        const history = await tariffHistoryModel.find(query)
            .sort({ createdAt: -1 })
            .limit(Number(limit));
            
        res.status(200).json(history);
    } catch (error) {
        next(error);
    }
};

module.exports.scheduleTariff = async (req, res, next) => {
    try {
        const { categoryId, scheduledFor, changes } = req.body;
        
        const tariffScheduleModel = require('../models/tariffSchedule.model');
        const schedule = await tariffScheduleModel.create({
            categoryId: categoryId || null,
            scheduledFor: new Date(scheduledFor),
            changes,
            createdBy: req.admin._id
        });
        
        res.status(201).json(schedule);
    } catch (error) {
        next(error);
    }
};

module.exports.duplicateCategory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const vehicleCategoryModel = require('../models/vehicleCategory.model');
        const original = await vehicleCategoryModel.findById(id);
        if (!original) {
            return res.status(404).json({ message: "Categoria não encontrada" });
        }
        
        const copyData = original.toObject();
        delete copyData._id;
        delete copyData.createdAt;
        delete copyData.updatedAt;
        
        copyData.name = copyData.name + '_copy_' + Date.now();
        copyData.displayName = copyData.displayName + ' (Cópia)';
        copyData.isActive = false; // Starts inactive
        
        const duplicate = await vehicleCategoryModel.create(copyData);
        
        const tariffHistoryModel = require('../models/tariffHistory.model');
        await tariffHistoryModel.create({
            admin: req.admin.name || req.admin.email,
            ip: req.ip,
            browser: req.headers['user-agent'],
            action: 'create',
            entity: 'VehicleCategory',
            categoryId: duplicate._id,
            newValue: copyData,
            reason: `Categoria duplicada de: ${original.displayName}`
        });
        
        res.status(201).json(duplicate);
    } catch (error) {
        next(error);
    }
};
