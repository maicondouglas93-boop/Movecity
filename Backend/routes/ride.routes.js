const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const rideController = require('../controllers/ride.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { rideStartPinLimiter } = require('../middlewares/rateLimiter');


router.post('/create',
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('vehicleType').isString().isLength({ min: 1 }).withMessage('Invalid vehicle type'),
    body('scheduledAt').optional({ values: 'null' }).isISO8601().withMessage('scheduledAt must be ISO8601'),
    // Auditoria financeira (2026-08-08, CRÍTICO #2): sem isto, um cliente podia enviar
    // paymentMethod:'card' direto na API — método que a UI nunca oferece e que não tem
    // cobrança real por trás (Asaas não está integrado) — e ainda assim receber
    // pendingBalance sacável no confirmPaymentReceived. 'carteira' fica de fora de
    // propósito: é decidido pelo servidor (useWalletBalance cobrindo 100% da corrida),
    // nunca enviado pelo cliente.
    body('paymentMethod').optional().isIn([ 'cash', 'pix' ]).withMessage('Invalid payment method'),
    rideController.createRide
)

// Corrida presencial (motorista inicia, sem despacho).
router.post('/presential',
    authMiddleware.authCaptain,
    body('destinationPending').optional().isBoolean().withMessage('destinationPending must be boolean'),
    body('destination').optional().isString().isLength({ min: 3 }).withMessage('Invalid destination'),
    body('paymentMethod').optional().isIn([ 'cash' ]),
    body('passengerPhone').optional().isString().isLength({ max: 20 }),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('vehicleType').optional().isString().isLength({ min: 1, max: 60 }),
    rideController.createPresentialRide
)

router.get('/presential/estimate',
    authMiddleware.authCaptain,
    query('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination'),
    query('lat').optional().isFloat({ min: -90, max: 90 }),
    query('lng').optional().isFloat({ min: -180, max: 180 }),
    query('vehicleType').optional().isString().isLength({ min: 1, max: 60 }),
    rideController.estimatePresentialFare
)

// Categorias que ESTE motorista pode usar na corrida presencial (car / moto / ambas).
router.get('/presential/vehicle-types',
    authMiddleware.authCaptain,
    rideController.listPresentialVehicleOptions
)

router.get('/current',
    authMiddleware.authUser,
    rideController.getCurrentRide
)

router.post('/share',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Corrida inválida'),
    rideController.createRideShareLink
)

// Link temporário compartilhado pelo próprio passageiro. Somente leitura e payload
// sanitizado; o token assinado substitui autenticação de conta nesta rota específica.
router.get('/share/:token', rideController.getSharedRide)

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

router.post('/:id/decline',
    authMiddleware.authCaptain,
    param('id').isMongoId().withMessage('Invalid ride id'),
    rideController.declineRide
)

router.get('/start-ride',
    authMiddleware.authCaptain,
    rideStartPinLimiter,
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
    body('destination').optional().isString().isLength({ min: 3, max: 300 }).withMessage('Invalid destination'),
    body('finishLat').optional().isFloat({ min: -90, max: 90 }),
    body('finishLng').optional().isFloat({ min: -180, max: 180 }),
    body('finishAccuracy').optional({ values: 'null' }).isFloat({ min: 0 }),
    body('finishTimestamp').optional({ values: 'null' }).isNumeric(),
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
