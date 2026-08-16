const adminService = require('../services/admin.service');
const { validationResult } = require('express-validator');
const { toAdminRideDTO, toAdminParcelDTO } = require('../utils/actorDtos');

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

// Auditoria de sessão persistente (2026-08-02, achado A1): o painel confiava no
// localStorage no boot â€” se o admin tivesse sido desativado ou a sessão revogada, a UI
// renderizava como autenticada até a primeira chamada falhar. Este endpoint deixa o
// frontend confirmar a sessão contra o servidor antes de mostrar qualquer coisa.
// authAdmin já valida token + existência + `active`; se chegou aqui, é válido.
module.exports.me = async (req, res) => {
    res.status(200).json({
        admin: {
            _id: req.admin._id,
            name: req.admin.name,
            email: req.admin.email,
            role: req.admin.role,
        }
    });
};

module.exports.logout = async (req, res, next) => {
    try {
        // Revoga só a sessão deste dispositivo quando o refresh token vem junto; sem
        // ele, encerra todas as sessões do admin (ver invalidateRefreshToken).
        const refreshToken = req.cookies?.adminRefreshToken || req.body?.refreshToken;
        if (req.admin) {
            await adminService.invalidateRefreshToken(req.admin._id, refreshToken);
        }
        res.clearCookie('adminToken');
        res.clearCookie('adminRefreshToken');
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
        const result = await adminService.updateUserTags(id, tags, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.addUserObservation = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { text } = req.body;
        const result = await adminService.addUserObservation(id, text, req.admin, req.ip);
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

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'send_notification',
            targetModel: 'Notification',
            reason: `Notificação enviada para ${target}: "${title}"`,
            newValue: { target, title, message },
            ipAddress: req.ip
        });

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

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'create_campaign',
            targetId: campaign._id.toString(),
            targetModel: 'NotificationCampaign',
            reason: `Campanha criada: "${title}"`,
            newValue: { title, type, targetRules, scheduledAt },
            ipAddress: req.ip
        });

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

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'cancel_campaign',
            targetId: campaign._id.toString(),
            targetModel: 'NotificationCampaign',
            reason: `Campanha cancelada: "${campaign.title}"`,
            ipAddress: req.ip
        });

        res.status(200).json(campaign);
    } catch (error) {
        next(error);
    }
};

// PROMOTIONS ENGINE
const parseCouponDate = (value, endOfDay = false) => {
    if (!value) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
        return new Date(`${value}T${time}-03:00`);
    }
    return new Date(value);
};

module.exports.createPromotion = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: 'Dados do cupom inválidos', errors: errors.array() });
        }

        const Promotion = require('../models/promotion.model');
        const code = req.body.code.trim().toUpperCase();
        const duplicate = await Promotion.exists({ type: 'coupon', code });
        if (duplicate) {
            return res.status(409).json({ message: 'Já existe um cupom com este código' });
        }

        const data = {
            type: 'coupon',
            code,
            title: req.body.title.trim(),
            description: req.body.description?.trim(),
            discountType: req.body.discountType,
            value: Number(req.body.value),
            maxDiscountLimit: req.body.discountType === 'percentage' && req.body.maxDiscountLimit
                ? Number(req.body.maxDiscountLimit)
                : undefined,
            rules: req.body.rules,
            startDate: parseCouponDate(req.body.startDate),
            endDate: parseCouponDate(req.body.endDate, true),
            budgetLimit: req.body.budgetLimit ? Number(req.body.budgetLimit) : undefined,
            globalUsageLimit: req.body.globalUsageLimit ? Number(req.body.globalUsageLimit) : undefined,
            usagePerUserLimit: req.body.usagePerUserLimit ? Number(req.body.usagePerUserLimit) : 1,
            status: 'active',
            auditLogs: [{
                adminId: req.admin._id,
                adminName: req.admin.name || 'Admin',
                action: 'created',
                details: 'Cupom criado e ativado'
            }]
        };

        const promotion = new Promotion(data);
        await promotion.save();

        const auditService = require('../services/audit.service');
        await auditService.logAction(req.admin._id, 'CREATE', 'Promotion', promotion._id, { title: data.title, code: data.code }, req.ip);

        if (req.body.sendPush) {
            const NotificationCampaign = require('../models/notificationCampaign.model');
            await NotificationCampaign.create({
                title: data.title,
                message: `${data.description ? `${data.description} ` : ''}Use o cupom ${code} na sua próxima corrida.`,
                deepLink: 'home',
                type: 'promotion',
                targetRules: { audienceType: 'passengers' },
                adminId: req.admin._id,
                status: 'scheduled',
                scheduledAt: data.startDate
            });
        }

        res.status(201).json(promotion);
    } catch (error) {
        next(error);
    }
};

// Status "efetivo" pro painel (auditoria de UX, 2026-08-10) — o campo `status`
// persistido nunca transiciona sozinho quando o orçamento acaba ou a data passa;
// `findApplicablePromotion` (promotion.service.js:55-59) já rejeita o resgate nesses
// casos, então o comportamento real está correto — só a badge da lista ficava
// mostrando "ativa" indefinidamente. Não escreve nada no banco, só informa a UI.
function computeEffectiveStatus(promo) {
    if (['draft', 'paused', 'finished', 'cancelled'].includes(promo.status)) return promo.status;
    const now = new Date();
    if (promo.endDate && new Date(promo.endDate) < now) return 'expired';
    if (promo.startDate && new Date(promo.startDate) > now) return 'scheduled';
    if (promo.budgetLimit && (promo.currentBudgetUsed || 0) >= promo.budgetLimit) return 'exhausted';
    return promo.status;
}

module.exports.getPromotions = async (req, res, next) => {
    try {
        const Promotion = require('../models/promotion.model');
        const promotions = await Promotion.find({
            type: 'coupon',
            code: { $exists: true, $ne: '' },
            discountType: { $in: ['percentage', 'fixed'] }
        }).sort({ createdAt: -1 });
        const withEffectiveStatus = promotions.map((p) => ({ ...p.toObject(), effectiveStatus: computeEffectiveStatus(p) }));
        res.status(200).json({ promotions: withEffectiveStatus });
    } catch (error) {
        next(error);
    }
};

module.exports.updatePromotionStatus = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: 'Status do cupom inválido', errors: errors.array() });
        }

        const { id } = req.params;
        const { status } = req.body;
        const Promotion = require('../models/promotion.model');
        
        const promotion = await Promotion.findById(id);
        const isSupportedCoupon = promotion
            && promotion.type === 'coupon'
            && promotion.code
            && ['percentage', 'fixed'].includes(promotion.discountType);
        if (!isSupportedCoupon) return res.status(404).json({ message: 'Cupom não encontrado' });

        const previousStatus = promotion.status;
        promotion.status = status;
        promotion.auditLogs.push({
            adminId: req.admin._id,
            adminName: req.admin.name || 'Admin',
            action: 'updated_status',
            details: `Status alterado para ${status}`
        });

        await promotion.save();

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'update_promotion_status',
            targetId: promotion._id.toString(),
            targetModel: 'Promotion',
            reason: `Status do cupom "${promotion.title}" alterado de ${previousStatus} para ${status}`,
            oldValue: { status: previousStatus },
            newValue: { status },
            ipAddress: req.ip
        });

        res.status(200).json(promotion);
    } catch (error) {
        next(error);
    }
};

module.exports.simulatePromotion = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: 'Dados da simulação inválidos', errors: errors.array() });
        }

        const { rideValue, promotionData } = req.body;
        const promotionService = require('../services/promotion.service');
        const { discount, clientPays, subsidy } = promotionService.evaluateDiscount(promotionData, rideValue);

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
        const { page = 1, limit = 10, search = '', status, approvalStatus, vehicleType, vehicleAuthorization, isOnline, isBlocked, operationalStatus } = req.query;
        // Bug de UX (auditoria 2026-08-10): a tela envia esses filtros na query, mas
        // eles nunca chegavam ao service — o admin selecionava "Online"/"Bloqueados" e
        // a lista voltava sempre igual, sem nenhum filtro de fato aplicado.
        const filters = { status, approvalStatus, vehicleType, vehicleAuthorization, isOnline, isBlocked, operationalStatus };
        const result = await adminService.getCaptains(Number(page), Number(limit), search, filters);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getLiveMapCaptains = async (req, res, next) => {
    try {
        const result = await adminService.getLiveMapCaptains();
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

module.exports.resetCaptainPassword = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { newPassword, reason } = req.body;
        if (typeof newPassword !== 'string' || newPassword.length < 6) {
            return res.status(400).json({ message: 'A nova senha deve ter pelo menos 6 caracteres' });
        }
        const result = await adminService.resetCaptainPassword(id, newPassword, req.admin, reason, req.ip);
        res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.uploadCaptainDocument = async (req, res, next) => {
    try {
        const { id, docType } = req.params;
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado' });
        }
        const result = await adminService.uploadCaptainDocument(id, docType, req.file.buffer, req.admin, req.ip);
        res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.updateCaptainVehicle = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { vehicle, reason } = req.body;
        if (!vehicle || typeof vehicle !== 'object') {
            return res.status(400).json({ message: 'Payload vehicle é obrigatório' });
        }
        const result = await adminService.updateCaptainVehicle(id, vehicle, req.admin, req.ip, reason);
        res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
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
        const result = await adminService.updateCaptainDocument(id, docType, verified, reason, req.admin, req.ip);
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

module.exports.getRideTimeline = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await adminService.getRideTimeline(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getRides = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, search = '', status, vehicleType, paymentMethod, period, type, source } = req.query;
        const result = await adminService.getRides(Number(page), Number(limit), search, { status, vehicleType, paymentMethod, period, type, source });
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.getManualRideAccessCode = async (req, res, next) => {
    if (manualRideValidationError(req, res)) return;
    try {
        const Ride = require('../models/ride.model');
        const ride = await Ride.findOne({ _id: req.params.id, source: 'admin' })
            .select('+otp status')
            .lean();
        if (!ride) {
            return res.status(404).json({ message: 'Corrida lançada pelo painel não encontrada.' });
        }
        if (['finished', 'cancelled'].includes(ride.status)) {
            return res.status(409).json({ message: 'O PIN não fica disponível depois do encerramento da corrida.' });
        }
        return res.status(200).json({ otp: ride.otp });
    } catch (error) {
        next(error);
    }
};

module.exports.getManualRideDispatchStatus = async (req, res, next) => {
    if (manualRideValidationError(req, res)) return;
    try {
        const status = await require('../services/manualRideDispatch.service')
            .getManualDispatchStatus(req.params.id);
        return res.status(200).json(status);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message, code: error.code });
        }
        next(error);
    }
};

module.exports.relaunchManualRide = async (req, res, next) => {
    if (manualRideValidationError(req, res)) return;
    try {
        const rideResponse = await require('../services/manualRideDispatch.service').relaunchManualRide({
            rideId: req.params.id,
            admin: req.admin,
            ip: req.ip,
        });
        return res.status(200).json(rideResponse);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                message: error.message,
                code: error.code,
                manualDispatch: error.dispatchState,
            });
        }
        next(error);
    }
};

function manualRideValidationError(req, res) {
    const errors = validationResult(req);
    if (errors.isEmpty()) return false;
    res.status(400).json({
        message: errors.array()[0]?.msg || 'Revise os dados informados.',
        errors: errors.array(),
    });
    return true;
}

function normalizePassengerPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (String(value || '').trim().startsWith('+') && /^\d{10,15}$/.test(digits)) return `+${digits}`;
    if (/^\d{10,11}$/.test(digits)) return `+55${digits}`;
    if (/^55\d{10,11}$/.test(digits)) return `+${digits}`;
    if (/^\d{10,15}$/.test(digits)) return `+${digits}`;
    return null;
}

function manualRideCancellationWasDispatchFailure(ride) {
    return ride?.status === 'cancelled'
        && ride?.cancellationReason === 'Motorista selecionado ficou indisponível antes do despacho';
}

async function findManualRideForAdmin(Ride, adminId, idempotencyKey) {
    return Ride.findOne({ createdBy: adminId, idempotencyKey, source: 'admin' })
        .select('+otp')
        .populate('user captain createdBy', 'fullname phone name');
}

module.exports.estimateManualRide = async (req, res) => {
    if (manualRideValidationError(req, res)) return;
    try {
        const routePoint = (address, coordinates) => {
            const lat = Number(coordinates?.lat);
            const lng = Number(coordinates?.lng);
            return coordinates?.lat !== '' && coordinates?.lat != null
                && coordinates?.lng !== '' && coordinates?.lng != null
                && Number.isFinite(lat) && Number.isFinite(lng)
                ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
                : address;
        };
        const quote = await require('../services/ride.service').getFare(
            routePoint(req.body.pickup, req.body.pickupCoordinates),
            routePoint(req.body.destination, req.body.destinationCoordinates)
        );
        const vehicleType = req.body.vehicleType;
        if (!Number.isFinite(Number(quote.fare?.[vehicleType]))) {
            return res.status(400).json({ message: 'Categoria indisponível para corrida.' });
        }
        return res.status(200).json({
            distance: quote.distance,
            time: quote.time,
            fare: quote.fare[vehicleType],
            breakdown: quote.breakdown?.[vehicleType],
            showAsEstimate: quote.showAsEstimate,
        });
    } catch (error) {
        console.error('[admin/manual-ride] Falha na estimativa:', error.message);
        return res.status(422).json({ message: 'Não foi possível calcular essa rota. Confirme os endereços e tente novamente.' });
    }
};

module.exports.getManualRideAvailableCaptains = async (req, res) => {
    if (manualRideValidationError(req, res)) return;
    try {
        const dispatchService = require('../services/dispatch.service');
        const { pickupCoordinates, captains } = await dispatchService.findCaptainsNearPickup(
            req.body.pickup,
            req.body.vehicleType,
            {
                TRACE_ID: `AdminRideCandidates:${req.admin._id}`,
                pickupCoordinates: req.body.pickupCoordinates,
                excludeActiveRide: true,
                excludeActiveParcel: true,
                serviceKind: 'ride',
            }
        );
        const { haversineKm } = require('../services/maps/geo.util');
        const options = captains.map((captain) => ({
            _id: captain._id,
            fullname: captain.fullname,
            vehicleType: captain.vehicle?.vehicleType,
            rating: captain.rating,
            distanceKm: captain.location?.ltd != null && captain.location?.lng != null
                ? Math.round(haversineKm(
                    pickupCoordinates.lat,
                    pickupCoordinates.lng,
                    captain.location.ltd,
                    captain.location.lng
                ) * 10) / 10
                : null,
        })).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
        return res.status(200).json({ captains: options, pickupCoordinates });
    } catch (error) {
        console.error('[admin/manual-ride] Falha ao listar motoristas:', error.message);
        return res.status(422).json({ message: 'Não foi possível verificar os motoristas disponíveis para essa partida.' });
    }
};

module.exports.createManualRide = async (req, res, next) => {
    if (manualRideValidationError(req, res)) return;
    const Ride = require('../models/ride.model');
    const User = require('../models/user.model');
    const rideService = require('../services/ride.service');
    const dispatchService = require('../services/dispatch.service');
    const { dispatchRideToCaptains } = require('./ride.controller');
    const { manualRideResponse } = require('../services/manualRideDispatch.service');
    const { passenger, pickup, destination, vehicleType, paymentMethod, observation, captainId, idempotencyKey } = req.body;

    try {
        const existing = await findManualRideForAdmin(Ride, req.admin._id, idempotencyKey);
        if (manualRideCancellationWasDispatchFailure(existing)) {
            return res.status(409).json({ message: 'O motorista selecionado ficou indisponível. Escolha outro motorista ou use a distribuição automática.' });
        }
        if (existing) {
            return res.status(200).json(manualRideResponse(existing, { reused: true }));
        }

        let passengerPhone = normalizePassengerPhone(passenger.phone);
        let passengerName = passenger.name.trim();
        if (!passengerPhone) {
            return res.status(400).json({ message: 'Informe um telefone válido com DDD.' });
        }

        const { getCachedVehicleCategoryByName } = require('../services/vehicleCategoryCache.service');
        const category = await getCachedVehicleCategoryByName(vehicleType);
        const passengerCount = Number(passenger.passengerCount);
        if (category?.capacity && passengerCount > Number(category.capacity)) {
            return res.status(400).json({
                message: `${category.displayName || vehicleType} aceita no máximo ${category.capacity} passageiro(s).`,
            });
        }

        let user = null;
        if (passenger.userId) {
            user = await User.findById(passenger.userId);
            if (!user) return res.status(400).json({ message: 'Passageiro cadastrado não encontrado.' });
            if (user.isBlocked) return res.status(409).json({ message: 'Esse passageiro está bloqueado e não pode iniciar corridas.' });
            const hasActiveRide = await Ride.exists({
                user: user._id,
                status: { $in: ['requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started'] },
            });
            if (hasActiveRide) {
                return res.status(409).json({ message: 'Esse passageiro já possui uma corrida em andamento.' });
            }
            passengerName = [user.fullname?.firstname, user.fullname?.lastname].filter(Boolean).join(' ').trim() || passengerName;
            passengerPhone = normalizePassengerPhone(user.phone) || passengerPhone;
        }

        // O dropdown usa exatamente esta mesma regra. Revalidar no backend evita que um
        // motorista fique ocupado, saia do raio ou troque de categoria entre a seleção
        // e o clique em “Lançar corrida”.
        if (captainId) {
            const { captains } = await dispatchService.findCaptainsNearPickup(
                pickup.address,
                vehicleType,
                {
                    TRACE_ID: `AdminRidePreflight:${req.admin._id}`,
                    pickupCoordinates: pickup,
                    excludeActiveRide: true,
                    excludeActiveParcel: true,
                    serviceKind: 'ride',
                }
            );
            if (!captains.some((captain) => String(captain._id) === String(captainId))) {
                return res.status(409).json({ message: 'Motorista indisponível, ocupado, incompatível ou fora do raio.' });
            }
        }

        const { ride, replayed } = await rideService.createRide({
            user: user?._id,
            pickup: pickup.address.trim(),
            destination: destination.address.trim(),
            vehicleType,
            paymentMethod,
            observation: observation?.trim(),
            source: 'admin',
            createdBy: req.admin._id,
            createdByRole: 'admin',
            idempotencyKey,
            adminPassenger: {
                name: passengerName,
                phone: passengerPhone,
                passengerCount,
                note: passenger.note?.trim(),
            },
            pickupCoordinates: { lat: Number(pickup.lat), lng: Number(pickup.lng) },
            destinationCoordinates: { lat: Number(destination.lat), lng: Number(destination.lng) },
        });

        // Duas instâncias podem ultrapassar o preflight ao mesmo tempo. O serviço
        // resolve a corrida pela chave; a perdedora devolve o mesmo documento sem
        // repetir despacho, log administrativo ou qualquer efeito financeiro.
        if (replayed) {
            if (manualRideCancellationWasDispatchFailure(ride)) {
                return res.status(409).json({ message: 'O motorista selecionado ficou indisponível. Escolha outro motorista ou use a distribuição automática.' });
            }
            return res.status(200).json(manualRideResponse(ride, { reused: true }));
        }

        // Marca o começo da janela exibida no painel e nos apps dos motoristas.
        // No relançamento este mesmo campo recebe um novo horário, sem criar outra corrida.
        ride.dispatchLastAttemptAt = new Date();
        await ride.save();

        const offeredCount = await dispatchRideToCaptains(ride, {
            pickup: pickup.address,
            vehicleType,
            TRACE_ID: `AdminRide:${ride._id}`,
            targetCaptainId: captainId || undefined,
            pickupCoordinates: pickup,
        });

        if (captainId && offeredCount !== 1) {
            const reason = 'Motorista selecionado ficou indisponível antes do despacho';
            await rideService.cancelRideByAdmin({
                rideId: ride._id,
                reason,
                admin: req.admin,
            });
            await adminService.logAction({
                adminId: req.admin._id,
                adminName: req.admin.name,
                action: 'create_manual_ride_dispatch_failed',
                targetId: ride._id.toString(),
                targetModel: 'Ride',
                reason,
                ipAddress: req.ip,
            });
            return res.status(409).json({ message: 'O motorista selecionado ficou indisponível. Escolha outro motorista ou use a distribuição automática.' });
        }

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'create_manual_ride',
            targetId: ride._id.toString(),
            targetModel: 'Ride',
            ipAddress: req.ip,
            newValue: {
                passenger: passengerName,
                captainId: captainId || null,
                vehicleType,
                pickup: pickup.address,
                destination: destination.address,
                paymentMethod,
                offeredCount,
            },
        });

        const result = await Ride.findById(ride._id)
            .select('+otp')
            .populate('user captain createdBy', 'fullname phone name');
        return res.status(201).json(manualRideResponse(result, {
                mode: captainId ? 'selected' : 'automatic',
                offeredCount,
        }));
    } catch (error) {
        if (error?.code === 11000 && idempotencyKey) {
            const ride = await findManualRideForAdmin(Ride, req.admin._id, idempotencyKey);
            if (manualRideCancellationWasDispatchFailure(ride)) {
                return res.status(409).json({ message: 'O motorista selecionado ficou indisponível. Escolha outro motorista ou use a distribuição automática.' });
            }
            if (ride) return res.status(200).json(manualRideResponse(ride, { reused: true }));
        }
        if (error?.code === 'USER_HAS_ACTIVE_PARCEL') {
            return res.status(409).json({ message: 'Esse passageiro já possui uma encomenda em andamento.' });
        }
        if (error?.code === 'USER_HAS_ACTIVE_RIDE') {
            return res.status(409).json({ message: 'Esse passageiro já possui uma corrida em andamento.' });
        }
        if (error?.code === 'VEHICLE_CATEGORY_NOT_ALLOWED_FOR_SERVICE') {
            return res.status(400).json({ message: 'A categoria selecionada não está habilitada para corridas.' });
        }
        next(error);
    }
};

module.exports.cancelRide = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const result = await adminService.cancelRide(id, reason, req.admin, req.ip);

        // Espelha o cancel de encomenda: avisa motorista (e passageiro, se houver)
        // por sala + socket direto + push ? senão o APK fica na tela da corrida.
        try {
            const { sendMessageToRoom, sendMessageToSocketId, emitDriverMapUpdate } = require('../socket');
            const captainModel = require('../models/captain.model');
            const userModel = require('../models/user.model');
            const notificationService = require('../services/notification.service');

            const payload = {
                rideId: result._id.toString(),
                cancelledBy: 'admin',
                reason: reason || result.cancellationReason || 'Cancelada pelo administrador',
            };

            sendMessageToRoom(`ride_${result._id}`, {
                event: 'ride-cancelled',
                data: payload,
            });

            if (result.captain) {
                const captainId = result.captain._id || result.captain;
                emitDriverMapUpdate(captainId, { busy: false });
                const captain = await captainModel.findById(captainId).select('socketId').lean();
                if (captain?.socketId) {
                    sendMessageToSocketId(captain.socketId, {
                        event: 'ride-cancelled',
                        data: payload,
                    });
                }
                notificationService
                    .sendRideCancelledToCaptain(captainId, { ...payload, cancelledBy: 'admin' })
                    .catch(console.error);
            }

            if (result.user) {
                const userId = result.user._id || result.user;
                const user = await userModel.findById(userId).select('socketId').lean();
                if (user?.socketId) {
                    sendMessageToSocketId(user.socketId, {
                        event: 'ride-cancelled',
                        data: payload,
                    });
                }
            }
        } catch (socketErr) {
            console.error('[ADMIN] Falha ao emitir cancel de corrida via socket:', socketErr.message);
        }

        res.status(200).json(toAdminRideDTO(result));
    } catch (error) {
        if (error.code === 'CANCELLATION_IN_PROGRESS') {
            return res.status(409).json({ code: error.code, message: 'Cancelamento já está sendo processado.' });
        }
        if (error.code === 'CANCELLATION_RETRY_REQUIRED') {
            return res.status(503).json({ code: error.code, message: 'Cancelamento financeiro pendente; repita a operação para reconciliar.' });
        }
        next(error);
    }
};

module.exports.reassignRide = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { ride, previousCaptain } = await adminService.reassignRide(id, req.admin, req.ip);

        // Bloco E (2026-08-02): antes disto, ninguém era avisado da reatribuição â€” nem o
        // motorista removido (continuava vendo a corrida como sua até o próximo refresh),
        // nem outros motoristas (a corrida voltava a 'requested' mas não era redespachada).
        const { sendMessageToRoom } = require('../socket');
        sendMessageToRoom(`ride_${ride._id}`, {
            event: 'ride-reassigned-by-admin',
            data: { rideId: ride._id }
        });

        // Presencial nunca deve ser redespachada (defesa em profundidade; o service já bloqueia).
        if (ride.source !== 'driver_initiated') {
            const { dispatchRideToCaptains } = require('./ride.controller');
            await dispatchRideToCaptains(ride, {
                pickup: ride.pickup,
                vehicleType: ride.vehicleType,
                TRACE_ID: `Ride:${ride._id}:AdminReassign`,
                excludeCaptainId: previousCaptain
            });
        }

        res.status(200).json(toAdminRideDTO(ride));
    } catch (error) {
        if (error.message === 'Corrida não encontrada' || error.message === 'Ride not found') {
            return res.status(404).json({ message: error.message });
        }
        if (
            error.message.includes('não pode ser reatribuída')
            || error.message.includes('não pode ser reatribuída')
            || error.message.includes('não pode ser reatribuída ao despacho')
            || error.message.includes('Ride cannot be reassigned')
            || error.message.includes('Corrida presencial')
        ) {
            return res.status(409).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.bulkActionRides = async (req, res, next) => {
    try {
        const { rideIds, actionType, reason } = req.body;
        const result = await adminService.bulkActionRides(rideIds, actionType, reason, req.admin, req.ip);
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
        // bloqueado etc.) precisam do err.message de verdade â€” em produção, next(error) cairia
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
        const { page = 1, limit = 20 } = req.query;
        const result = await adminService.getCaptainFinancialHistory(id, Number(page), Number(limit));
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
        // Bloco E (2026-08-02, achado C1): conflito de edição concorrente â€” nosso próprio
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
        if (error.statusCode === 400) {
            return res.status(400).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.getLogs = async (req, res, next) => {
    try {
        const { page = 1, limit = 15, adminName, action, targetModel, targetId, startDate, endDate } = req.query;
        const result = await adminService.getLogs(Number(page), Number(limit), {
            adminName, action, targetModel, targetId, startDate, endDate
        });
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

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'schedule_tariff',
            targetId: (categoryId || schedule._id).toString(),
            targetModel: categoryId ? 'VehicleCategory' : 'TariffSetting',
            reason: `Alteração de tarifas agendada para ${new Date(scheduledFor).toLocaleString()}`,
            newValue: changes,
            ipAddress: req.ip
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

        // Auditoria de cache (2026-08-08, A3): categoria nova começa isActive:false,
        // mas invalida mesmo assim — mantém o cache sempre consistente com o banco.
        const { invalidateVehicleCategoryCache } = require('../services/vehicleCategoryCache.service');
        invalidateVehicleCategoryCache();

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

// --- Encomendas (MVP) ---
const parcelService = require('../services/parcel.service');

module.exports.getParcels = async (req, res, next) => {
    try {
        const { status, limit, skip } = req.query;
        const result = await parcelService.listParcelsAdmin({
            status,
            limit: Number(limit) || 50,
            skip: Number(skip) || 0,
        });
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports.cancelParcelAdmin = async (req, res, next) => {
    try {
        const parcel = await parcelService.adminCancelParcel({
            parcelId: req.params.id,
            reason: req.body.reason,
            admin: req.admin,
        });

        try {
            const { sendMessageToRoom, sendMessageToSocketId, emitDriverMapUpdate } = require('../socket');
            const payload = { parcelId: parcel._id.toString(), reason: req.body.reason || 'Cancelado pelo admin' };
            sendMessageToRoom(`parcel_${parcel._id}`, {
                event: 'parcel-cancelled',
                data: payload,
            });
            if (parcel.user?.socketId) {
                sendMessageToSocketId(parcel.user.socketId, {
                    event: 'parcel-cancelled',
                    data: payload,
                });
            }
            if (parcel.captain) {
                const captainId = parcel.captain._id || parcel.captain;
                emitDriverMapUpdate(captainId, { busy: false });
                if (parcel.captain.socketId) {
                    sendMessageToSocketId(parcel.captain.socketId, {
                        event: 'parcel-cancelled',
                        data: payload,
                    });
                }
            }
        } catch (socketErr) {
            console.error('[PARCEL] Falha ao emitir cancel admin via socket:', socketErr.message);
        }

        res.status(200).json(toAdminParcelDTO(parcel));
    } catch (error) {
        if (error.message === 'PARCEL_NOT_FOUND') return res.status(404).json({ message: 'Encomenda não encontrada' });
        if (error.message === 'PARCEL_NOT_CANCELLABLE') return res.status(400).json({ message: error.message });
        if (error.code === 'CANCELLATION_IN_PROGRESS') {
            return res.status(409).json({ code: error.code, message: 'Cancelamento já está sendo processado.' });
        }
        if (error.code === 'CANCELLATION_RETRY_REQUIRED') {
            return res.status(503).json({ code: error.code, message: 'Cancelamento pendente de reconciliação; repita a operação.' });
        }
        next(error);
    }
};

module.exports.getParcelSettings = async (req, res, next) => {
    try {
        const settings = await parcelService.getSettings();
        res.status(200).json(settings);
    } catch (error) {
        next(error);
    }
};

module.exports.updateParcelSettings = async (req, res, next) => {
    try {
        const settings = await parcelService.updateSettings(req.body || {});
        res.status(200).json(settings);
    } catch (error) {
        next(error);
    }
};
module.exports.simulateFare = async (req, res, next) => {
    try {
        const {
            distance,
            time,
            vehicleType: vehicleTypeBody,
            vehicleCategoryId,
            serviceKind,
            waitTimeSeconds,
            extraStopsCount,
            optionals,
            customPricing,
        } = req.body;

        const VehicleCategory = require("../models/vehicleCategory.model");
        let vehicleType = vehicleTypeBody;
        if (!vehicleType && vehicleCategoryId) {
            const byId = await VehicleCategory.findById(vehicleCategoryId).lean();
            if (!byId) {
                return res.status(404).json({ message: "Categoria n�o encontrada." });
            }
            vehicleType = byId.name;
        }

        if (distance == null || time == null || !vehicleType) {
            return res.status(400).json({ message: "distance, time e vehicleType (ou vehicleCategoryId) s�o obrigat�rios." });
        }

        const PricingEngine = require("../services/pricingEngine.service");
        const kind = serviceKind || "ride";
        let configSnapshot = null;

        if (customPricing) {
            const categoryDoc = await VehicleCategory.findOne({ name: vehicleType });
            if (categoryDoc) {
                const categoryObj = categoryDoc.toObject();
                categoryObj.pricing = customPricing;
                const parcelAdj = customPricing.parcelAdjustment || {
                    isActive: false,
                    type: "percentage",
                    value: 0,
                };
                configSnapshot = {
                    category: categoryObj,
                    globalSetting: { cardFeePercent: 0, cardFeeFixed: 0 },
                    serviceKind: kind,
                    parcelAdjustment: {
                        isActive: Boolean(parcelAdj.isActive),
                        type: parcelAdj.type === "fixed" ? "fixed" : "percentage",
                        value: Number(parcelAdj.value) || 0,
                    },
                };
            }
        }

        // distance/time no simulador admin: km e minutos ? converter para m/s do engine
        const distanceMeters = Number(distance) * 1000;
        const timeSeconds = Number(time) * 60;
        const waitSeconds = Number(waitTimeSeconds || 0) * 60;

        const simulation = await PricingEngine.calculateFare({
            distance: distanceMeters,
            time: timeSeconds,
            vehicleType,
            serviceKind: kind,
            waitTimeSeconds: waitSeconds,
            extraStopsCount: extraStopsCount || 0,
            optionals: optionals || {},
            paymentMethod: "cash",
            configSnapshot: configSnapshot
        });

        res.status(200).json(simulation);
    } catch (error) {
        next(error);
    }
};

module.exports.finalizeRide = async (req, res, next) => {
    try {
        const ride = await adminService.finalizeRideByAdmin({
            rideId: req.params.id,
            admin: req.admin,
            reason: req.body.reason,
            observation: req.body.observation,
            ip: req.ip,
        });
        res.status(200).json(toAdminRideDTO(ride));
    } catch (error) {
        const status = error.statusCode || (error.message?.includes('não') ? 409 : 500);
        res.status(status).json({ message: error.message });
    }
};
