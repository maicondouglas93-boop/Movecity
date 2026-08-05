const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const adminAuth = require('../middlewares/adminAuth.middleware');
const { notificationTokenLimiter } = require('../middlewares/rateLimiter');
const { body, param, query } = require('express-validator');

// Rota para registrar token FCM (pode ser chamada por passageiros ou motoristas)
router.post('/token',
    notificationTokenLimiter,
    authMiddleware.authBoth,
    [
        body('token').isString().notEmpty().withMessage('Token is required'),
    ],
    notificationController.registerToken
);

// A3 da auditoria de push (2026-08-02): chamado no logout pra desvincular o token FCM
// deste dispositivo da conta que está saindo.
router.delete('/token',
    authMiddleware.authBoth,
    notificationController.unregisterToken
);

// --- Central de notificações (inbox) — passageiro ou motorista ---

router.get('/',
    authMiddleware.authBoth,
    [
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('category').optional().isString(),
        query('unread').optional().isIn(['true', 'false', '1', '0']),
        query('cursor').optional().isISO8601(),
    ],
    notificationController.listNotifications
);

router.get('/unread',
    authMiddleware.authBoth,
    notificationController.getUnread
);

router.patch('/read-all',
    authMiddleware.authBoth,
    notificationController.markAllRead
);

router.patch('/:id/read',
    authMiddleware.authBoth,
    [param('id').isMongoId()],
    notificationController.markRead
);

router.delete('/clear-read',
    authMiddleware.authBoth,
    notificationController.clearRead
);

router.delete('/:id',
    authMiddleware.authBoth,
    [param('id').isMongoId()],
    notificationController.deleteNotification
);

// Envio pelo painel (também existe POST /api/admin/notifications legado)
router.post('/admin',
    adminAuth.authAdmin,
    adminAuth.authorizeRoles('super_admin', 'operador', 'marketing'),
    [
        body('title').isString().isLength({ min: 1, max: 120 }),
        body('message').isString().isLength({ min: 1, max: 500 }),
        body('target').optional().isIn(['all', 'passengers', 'drivers', 'specific']),
    ],
    notificationController.adminSend
);

module.exports = router;
