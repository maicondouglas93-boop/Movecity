const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authAdmin, authorizeRoles } = require('../middlewares/adminAuth.middleware');
const { loginLimiter } = require('../middlewares/rateLimiter');

// Auth Routes
router.post('/login', loginLimiter, adminController.login);
router.post('/logout', authAdmin, adminController.logout);

// Dashboard Route
router.get('/dashboard', authAdmin, adminController.getDashboard);
router.get('/health', authAdmin, adminController.getHealthStatus);

// Marketing / Campaigns
router.post('/notifications', authAdmin, authorizeRoles('super_admin', 'operador', 'marketing'), adminController.sendNotification); // Legacy (maybe used elsewhere)
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
router.put('/captains/:id/approval', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.updateCaptainApproval);
router.put('/captains/:id/block', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.toggleCaptainBlock);
router.get('/captains/:id/documents', authAdmin, adminController.getCaptainDocuments);
router.put('/captains/:id/documents/:docType', authAdmin, authorizeRoles('super_admin', 'operador', 'suporte'), adminController.updateCaptainDocument);
router.get('/captains/:id/recent-rides', authAdmin, adminController.getCaptainRecentRides);
router.get('/captains/:id/wallet', authAdmin, adminController.getCaptainWallet);
router.post('/captains/:id/wallet/adjust', authAdmin, authorizeRoles('super_admin', 'financeiro', 'operador'), adminController.adjustCaptainWallet);
router.get('/captains/:id/timeline', authAdmin, adminController.getCaptainTimeline);

// Rides
router.get('/rides', authAdmin, adminController.getRides);
router.put('/rides/:id/cancel', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.cancelRide);
router.put('/rides/:id/reassign', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.reassignRide);
router.post('/rides/bulk-action', authAdmin, authorizeRoles('super_admin', 'operador'), adminController.bulkActionRides);

// Finance (Payouts)
router.get('/payouts', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.getPayouts);
router.get('/payouts/:id', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.getPayoutDetails);
router.put('/payouts/:id/approve', authAdmin, authorizeRoles('super_admin', 'financeiro'), adminController.approvePayout);
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
router.post('/tariffs/schedule', authAdmin, authorizeRoles('super_admin'), adminController.scheduleTariff);

// Logs
router.get('/logs', authAdmin, authorizeRoles('super_admin'), adminController.getLogs);

module.exports = router;
