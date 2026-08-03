const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { notificationTokenLimiter } = require('../middlewares/rateLimiter');
const { body } = require('express-validator');

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

module.exports = router;
