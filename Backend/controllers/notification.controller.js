const NotificationToken = require('../models/notificationToken.model');
const { validationResult } = require('express-validator');

module.exports.registerToken = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { token, device } = req.body;
        
        let userId = null;
        let captainId = null;

        if (req.user) userId = req.user._id;
        else if (req.captain) captainId = req.captain._id;
        else return res.status(401).json({ message: 'Unauthorized' });

        // Upsert token
        await NotificationToken.findOneAndUpdate(
            { token },
            { 
                userId, 
                captainId, 
                device: device || 'web' 
            },
            { upsert: true, new: true }
        );

        res.status(200).json({ message: 'Token registrado com sucesso' });
    } catch (err) {
        console.error('Erro ao registrar token FCM:', err);
        res.status(500).json({ message: 'Internal server error', error: err.message });
    }
}
