const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const mapController = require('../controllers/map.controller');
const { query } = require('express-validator');
const { publicDriverMapLimiter } = require('../middlewares/rateLimiter');

router.get('/get-coordinates',
    authMiddleware.authBoth,
    query('address').isString().isLength({ min: 3 }),
    mapController.getCoordinates
);

router.get('/get-distance-time',
    authMiddleware.authBoth,
    query('origin').isString().isLength({ min: 3 }),
    query('destination').isString().isLength({ min: 3 }),
    mapController.getDistanceTime
)

// authBoth: o motorista usa para navegar; o passageiro, para desenhar o traçado da
// corrida no mapa. Mesmo endpoint, mesmo contrato.
router.get('/get-route',
    authMiddleware.authBoth,
    query('origin').isString().isLength({ min: 3 }),
    query('destination').isString().isLength({ min: 3 }),
    mapController.getRoute
)

router.get('/get-suggestions',
    authMiddleware.authBoth,
    query('input').isString().isLength({ min: 3 }),
    query('lat').optional().isNumeric(),
    query('lng').optional().isNumeric(),
    query('sessionToken').optional().isString(),
    mapController.getAutoCompleteSuggestions
)

router.get('/place-details',
    authMiddleware.authBoth,
    query('placeId').isString().isLength({ min: 1 }),
    query('sessionToken').optional().isString(),
    mapController.getPlaceDetails
)

router.get('/nearby-drivers',
    authMiddleware.authUser,
    publicDriverMapLimiter,
    query('lat').isNumeric(),
    query('lng').isNumeric(),
    mapController.getNearbyDrivers
)

router.get('/reverse-geocode',
    authMiddleware.authBoth,
    query('lat').isNumeric(),
    query('lng').isNumeric(),
    mapController.getReverseGeocode
)

module.exports = router;
