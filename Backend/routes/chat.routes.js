const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { body, param } = require('express-validator');

const checkAuth = async (req, res, next) => {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[ 1 ];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        await authMiddleware.authUser(req, res, () => {
            next();
        });
    } catch (userErr) {
        try {
            await authMiddleware.authCaptain(req, res, () => {
                next();
            });
        } catch (capErr) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
    }
};

// Novo: /chat/parcel/:subjectId e /chat/ride/:subjectId
router.get('/:subjectType/:subjectId',
    checkAuth,
    param('subjectType').isIn(['ride', 'parcel']),
    param('subjectId').isMongoId(),
    chatController.getChat
);

// Compat: /chat/:rideId (corrida)
router.get('/:rideId',
    checkAuth,
    param('rideId').isMongoId(),
    (req, res, next) => {
        req.query.subjectType = req.query.subjectType || 'ride';
        next();
    },
    chatController.getChat
);

router.post('/send', [
    checkAuth,
    body('message').isString().isLength({ min: 1, max: 500 }).withMessage('Message must be between 1 and 500 characters'),
    body('subjectType').optional().isIn(['ride', 'parcel']),
    body('subjectId').optional().isMongoId(),
    body('rideId').optional().isMongoId(),
    body().custom((value) => {
        if (!value.subjectId && !value.rideId) {
            throw new Error('subjectId or rideId is required');
        }
        return true;
    }),
], chatController.sendMessage);

router.patch('/read', [
    checkAuth,
    body('subjectType').optional().isIn(['ride', 'parcel']),
    body('subjectId').optional().isMongoId(),
    body('rideId').optional().isMongoId(),
    body().custom((value) => {
        if (!value.subjectId && !value.rideId) {
            throw new Error('subjectId or rideId is required');
        }
        return true;
    }),
], chatController.markRead);

module.exports = router;
