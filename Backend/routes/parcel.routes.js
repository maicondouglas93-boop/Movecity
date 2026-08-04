const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const parcelController = require('../controllers/parcel.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { parcelPinLimiter } = require('../middlewares/rateLimiter');

router.get('/fare',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }),
    query('destination').isString().isLength({ min: 3 }),
    query('vehicleType').isIn(['moto', 'car']),
    parcelController.getFare
);

router.post('/create',
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }),
    body('destination').isString().isLength({ min: 3 }),
    body('vehicleType').isIn(['moto', 'car']),
    body('sender.name').isString().isLength({ min: 2 }),
    body('sender.phone').isString().isLength({ min: 8 }),
    body('recipient.name').isString().isLength({ min: 2 }),
    body('recipient.phone').isString().isLength({ min: 8 }),
    body('itemName').isString().isLength({ min: 2 }),
    body('category').isIn(['documento', 'caixa', 'compras', 'comida', 'outros']),
    body('weightKg').isFloat({ min: 0, max: 100 }),
    body('size').isIn(['small', 'medium', 'large']),
    body('description').optional().isString(),
    body('notes').optional().isString(),
    parcelController.createParcel
);

router.get('/current', authMiddleware.authUser, parcelController.getCurrent);
router.get('/captain-current', authMiddleware.authCaptain, parcelController.getCurrentForCaptain);
router.get('/pending', authMiddleware.authCaptain, parcelController.getPending);

router.post('/review',
    authMiddleware.authUser,
    body('parcelId').optional().isMongoId(),
    body('subjectId').optional().isMongoId(),
    body('rating').isInt({ min: 1, max: 5 }),
    body('comment').optional().isString().isLength({ max: 500 }),
    body().custom((v) => {
        if (!v.parcelId && !v.subjectId) throw new Error('parcelId is required');
        return true;
    }),
    parcelController.submitReview
);

router.post('/captain-review',
    authMiddleware.authCaptain,
    body('parcelId').optional().isMongoId(),
    body('subjectId').optional().isMongoId(),
    body('rating').isInt({ min: 1, max: 5 }),
    body('comment').optional().isString().isLength({ max: 500 }),
    body().custom((v) => {
        if (!v.parcelId && !v.subjectId) throw new Error('parcelId is required');
        return true;
    }),
    parcelController.submitCaptainReview
);

router.post('/:id/skip-review',
    authMiddleware.authUser,
    param('id').isMongoId(),
    parcelController.skipReview
);

router.post('/:id/skip-captain-review',
    authMiddleware.authCaptain,
    param('id').isMongoId(),
    parcelController.skipCaptainReview
);

router.post('/:id/accept',
    authMiddleware.authCaptain,
    param('id').isMongoId(),
    parcelController.acceptParcel
);

router.post('/:id/decline',
    authMiddleware.authCaptain,
    param('id').isMongoId(),
    parcelController.declineParcel
);

router.patch('/:id/status',
    authMiddleware.authCaptain,
    param('id').isMongoId(),
    body('status').isIn([
        'going_to_pickup',
        'arrived_pickup',
        'collected',
        'in_transit',
        'arrived_destination',
    ]),
    parcelController.updateStatus
);

router.post('/:id/confirm-delivery',
    authMiddleware.authCaptain,
    parcelPinLimiter,
    param('id').isMongoId(),
    body('pin').optional().isString(),
    parcelController.confirmDelivery
);

router.post('/:id/cancel',
    authMiddleware.authUser,
    param('id').isMongoId(),
    body('reason').optional().isString().isLength({ max: 500 }),
    parcelController.cancelParcel
);

module.exports = router;
