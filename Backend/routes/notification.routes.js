const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { body } = require('express-validator');

// Rota para registrar token FCM (pode ser chamada por passageiros ou motoristas)
router.post('/token', 
    authMiddleware.authBoth,
    [
        body('token').isString().notEmpty().withMessage('Token is required'),
    ], 
    notificationController.registerToken
);

module.exports = router;
