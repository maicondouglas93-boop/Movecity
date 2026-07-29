const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { body } = require('express-validator');

// Auth middleware for both User and Captain
const checkAuth = async (req, res, next) => {
    // Try user auth first, if fails try captain auth
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

router.get('/:rideId', checkAuth, chatController.getChat);

router.post('/send', [
    checkAuth,
    body('rideId').isMongoId().withMessage('Invalid Ride ID'),
    body('message').isString().isLength({ min: 1, max: 500 }).withMessage('Message must be between 1 and 500 characters')
], chatController.sendMessage);

router.patch('/read', [
    checkAuth,
    body('rideId').isMongoId().withMessage('Invalid Ride ID')
], chatController.markRead);

module.exports = router;
