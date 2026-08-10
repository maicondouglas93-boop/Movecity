const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const adminMapsController = require('../controllers/adminMaps.controller');
const notificationController = require('../controllers/notification.controller');
const monitoringController = require('../controllers/monitoring.controller');
const uploadController = require('../controllers/upload.controller');
const { authAdmin, authorizeRoles } = require('../middlewares/adminAuth.middleware');
const { loginLimiter, notificationTokenLimiter } = require('../middlewares/rateLimiter');
const { body, query } = require('express-validator');

// Auth Routes
router.post('/login', loginLimiter, adminController.login);
router.post('/refresh', adminController.refresh);
router.get('/me', authAdmin, adminController.me);
router.post('/logout', authAdmin, adminController.logout);

// Dashboard Route
router.get('/dashboard', authAdmin, adminController.getDashboard);
router.get('/health', authAdmin, adminController.getHealthStatus);

// Monitoramento de serviços externos (somente super_admin)
router.get('/monitoring/services', authAdmin, authorizeRoles('super_admin'), monitoringController.getServicesDashboard);
router.get('/monitoring/status', authAdmin, authorizeRoles('super_admin'), monitoringController.getServicesStatus);
router.post('/monitoring/refresh', authAdmin, authorizeRoles('super_admin'), monitoringController.refreshServices);
router.get('/monitoring/services/:service', authAdmin, authorizeRoles('super_admin'), monitoringController.getServiceDetail);
router.get('/monitoring/alerts', authAdmin, authorizeRoles('super_admin'), monitoringController.getMonitorAlerts);
router.post('/monitoring/alerts/:id/ack', authAdmin, authorizeRoles('super_admin'), monitoringController.acknowledgeMonitorAlert);
router.get('/monitoring/audit', authAdmin, authorizeRoles('super_admin'), monitoringController.getMonitorAudit);

// Fase 7 da correção do sistema de push (2026-08-02): canal de push para o próprio
// painel administrativo (novo motorista pra aprovar, denúncia, problema de pagamento).
// Mesmo controller/tokenRegistry usados por passageiro e motorista — só o middleware de
// auth muda.
router.post('/notifications/token',
    notificationTokenLimiter,
    authAdmin,
    [ body('token').isString().notEmpty().withMessage('Token is required') ],
    notificationController.registerToken
);
router.delete('/notifications/token', authAdmin, notificationController.unregisterToken);

// Marketing / Campaigns
router.post('/notifications', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.sendNotification); // Legacy (maybe used elsewhere)
// Central in-app: cria registro por destinatário + push (ver notification.controller.adminSend)
router.post('/notifications/inbox', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), require('../controllers/notification.controller').adminSend);
router.get('/notifications/inbox-stats', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing', 'financeiro'), async (req, res) => {
    try {
        const { inboxStats } = require('../notification/inboxStats.service');
        const data = await inboxStats({ limit: req.query.limit });
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ message: err.message || 'Erro ao carregar métricas' });
    }
});
router.get('/campaigns', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.getCampaigns);
router.post('/campaigns', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.createCampaign);
router.post('/campaigns/estimate', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.estimateAudience);
router.post('/campaigns/:id/cancel', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.cancelCampaign);

// Promotions Engine
router.post('/promotions', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.createPromotion);
router.get('/promotions', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.getPromotions);
router.put('/promotions/:id/status', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.updatePromotionStatus);
router.post('/promotions/simulate', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.simulatePromotion);

// BI / Reports
router.get('/reports/dashboard', authAdmin, authorizeRoles('super_admin'), adminController.getReportDashboard);
router.get('/reports/charts', authAdmin, authorizeRoles('super_admin'), adminController.getReportCharts);
router.get('/reports/rankings', authAdmin, authorizeRoles('super_admin'), adminController.getReportRankings);
router.get('/reports/export/:type', authAdmin, authorizeRoles('super_admin'), adminController.exportReportCSV);

// Users
router.get('/users', authAdmin, adminController.getUsers);
router.get('/users/:id/details', authAdmin, adminController.getUserDetails);
router.put('/users/:id/block', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.toggleUserBlock);
router.post('/users/bulk-action', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.bulkActionUsers);
router.put('/users/:id/tags', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.updateUserTags);
router.post('/users/:id/observations', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.addUserObservation);

// Captains
router.get('/captains', authAdmin, adminController.getCaptains);
router.get('/captains/live-map', authAdmin, adminController.getLiveMapCaptains);
router.put('/captains/:id/approval', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.updateCaptainApproval);
router.put('/captains/:id/block', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.toggleCaptainBlock);
router.put('/captains/:id/vehicle', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.updateCaptainVehicle);
router.put('/captains/:id/reset-password', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.resetCaptainPassword);
router.get('/captains/:id/documents', authAdmin, adminController.getCaptainDocuments);
router.get('/captains/:id/documents/:docType/url', authAdmin, adminController.getCaptainDocumentUrl);
router.put('/captains/:id/documents/:docType', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.updateCaptainDocument);
router.post('/captains/:id/documents/:docType/upload', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), uploadController.uploadMiddleware, adminController.uploadCaptainDocument);
router.get('/captains/:id/recent-rides', authAdmin, adminController.getCaptainRecentRides);
router.get('/captains/:id/wallet', authAdmin, adminController.getCaptainWallet);
router.post('/captains/:id/wallet/adjust', authAdmin, authorizeRoles('super_admin', 'financeiro', 'operador'), adminController.adjustCaptainWallet);
router.get('/captains/:id/timeline', authAdmin, adminController.getCaptainTimeline);

// Rides
router.get('/rides', authAdmin, adminController.getRides);
router.put('/rides/:id/cancel', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.cancelRide);
router.put('/rides/:id/reassign', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.reassignRide);
router.put('/rides/:id/finalize', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.finalizeRide);
router.post('/rides/bulk-action', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.bulkActionRides);

// Finance (Payouts)
router.get('/payouts', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.getPayouts);
router.get('/payouts/:id', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.getPayoutDetails);
router.put('/payouts/:id/approve', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.approvePayout);
router.put('/payouts/:id/confirm-paid', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.confirmPayoutPaid);
router.put('/payouts/:id/reject', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.rejectPayout);
router.post('/payouts/bulk-approve', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.bulkApprovePayouts);
router.get('/captains/:id/financial-history', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.getCaptainFinancialHistory);

// Tariffs & Pricing Engine
router.get('/tariffs', authAdmin, adminController.getTariffs);
router.get('/vehicle-categories', authAdmin, adminController.getVehicleCategories);
router.post('/vehicle-categories', authAdmin, authorizeRoles('super_admin'), adminController.createVehicleCategory);
router.put('/settings/tariffs', authAdmin, authorizeRoles('super_admin'), adminController.updateTariff);
router.put('/vehicle-categories/:id/tariffs', authAdmin, authorizeRoles('super_admin'), adminController.updateVehicleCategory);
router.post('/vehicle-categories/:id/duplicate', authAdmin, authorizeRoles('super_admin'), adminController.duplicateCategory);
router.get('/tariffs/history', authAdmin, adminController.getTariffHistory);
router.post('/tariffs/simulate', authAdmin, authorizeRoles('super_admin'), adminController.simulateFare);
router.post(
    '/tariffs/estimate-route',
    authAdmin,
    authorizeRoles('super_admin'),
    body('pickup').isString().isLength({ min: 3 }),
    body('destination').isString().isLength({ min: 3 }),
    adminMapsController.estimateRoute
);
router.post('/tariffs/schedule', authAdmin, authorizeRoles('super_admin'), adminController.scheduleTariff);

// Mapas para o simulador de tarifas (token admin — /maps/* público só aceita user/captain)
router.get(
    '/maps/suggestions',
    authAdmin,
    authorizeRoles('super_admin'),
    query('input').isString().isLength({ min: 3 }),
    query('lat').optional().isNumeric(),
    query('lng').optional().isNumeric(),
    query('sessionToken').optional().isString(),
    adminMapsController.getSuggestions
);
router.get(
    '/maps/place-details',
    authAdmin,
    authorizeRoles('super_admin'),
    query('placeId').isString().isLength({ min: 1 }),
    query('sessionToken').optional().isString(),
    adminMapsController.getPlaceDetails
);

const globalTariffController = require('../controllers/globalTariff.controller');
router.get('/global-tariffs', authAdmin, authorizeRoles('super_admin'), globalTariffController.list);
router.post('/global-tariffs', authAdmin, authorizeRoles('super_admin'), globalTariffController.create);
router.put('/global-tariffs/:id', authAdmin, authorizeRoles('super_admin'), globalTariffController.update);
router.patch('/global-tariffs/:id/active', authAdmin, authorizeRoles('super_admin'), globalTariffController.setActive);
router.delete('/global-tariffs/:id', authAdmin, authorizeRoles('super_admin'), globalTariffController.remove);

// Logs
router.get('/logs', authAdmin, authorizeRoles('super_admin'), adminController.getLogs);

// Encomendas (MVP)
router.get('/parcels', authAdmin, adminController.getParcels);
router.put('/parcels/:id/cancel', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.cancelParcelAdmin);
router.get('/parcel-settings', authAdmin, adminController.getParcelSettings);
router.put('/parcel-settings', authAdmin, authorizeRoles('super_admin'), adminController.updateParcelSettings);

// Atualização do APK MoveCity Motorista (distribuição fora da Play Store)
const driverAppVersionController = require('../controllers/driverAppVersion.controller');
router.get('/driver-app-version', authAdmin, authorizeRoles('super_admin'), driverAppVersionController.getAdminDriverAppVersion);
router.put('/driver-app-version', authAdmin, authorizeRoles('super_admin'), driverAppVersionController.updateAdminDriverAppVersion);

module.exports = router;
