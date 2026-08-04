const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const rideController = require('../controllers/ride.controller');
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/create',
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('vehicleType').isString().isLength({ min: 1 }).withMessage('Invalid vehicle type'),
    rideController.createRide
)

router.get('/current',
    authMiddleware.authUser,
    rideController.getCurrentRide
)

router.post('/cancel',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('reason').optional().isString().isLength({ max: 500 }).withMessage('Invalid reason'),
    rideController.cancelRide
)

router.get('/captain-current',
    authMiddleware.authCaptain,
    rideController.getCurrentRideForCaptain
)

router.get('/captain-history',
    authMiddleware.authCaptain,
    rideController.getCaptainRideHistory
)

router.get('/pending',
    authMiddleware.authCaptain,
    rideController.getPendingRides
)

router.post('/captain-cancel',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('reason').optional().isString().isLength({ max: 500 }).withMessage('Invalid reason'),
    rideController.captainCancelRide
)

router.get('/get-fare',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    query('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    rideController.getFare
)

router.post('/confirm',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.confirmRide
)

router.post('/:id/accept',
    authMiddleware.authCaptain,
    rideController.acceptRide
)

router.get('/start-ride',
    authMiddleware.authCaptain,
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    query('otp').isString().isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
    rideController.startRide
)

router.post('/update-status',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('status').isString().withMessage('Invalid status'),
    rideController.updateRideStatus
)

router.post('/end-ride',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.endRide
)

router.post('/pay',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.payRide
)


router.post('/confirm-payment',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.confirmPaymentReceived
)

router.get('/history',
    authMiddleware.authUser,
    rideController.getRideHistory
)

router.post('/review',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment').optional().isString().isLength({ max: 500 }),
    body('issueCategory').optional().isIn(['none', 'delay', 'behavior', 'vehicle_cleanliness', 'overcharge']),
    rideController.submitReview
)

router.post('/captain-review',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment').optional().isString().isLength({ max: 500 }),
    rideController.submitCaptainReview
)

module.exports = router;