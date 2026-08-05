const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const authMiddleware = require('../middlewares/auth.middleware');
const scheduleController = require('../controllers/schedule.controller');

router.get(
    '/mine',
    authMiddleware.authUser,
    scheduleController.listMine
);

router.post(
    '/mine/cancel',
    authMiddleware.authUser,
    body('kind').isIn(['ride', 'parcel']),
    body('id').isMongoId(),
    scheduleController.cancelMine
);

router.get(
    '/captain/upcoming',
    authMiddleware.authCaptain,
    scheduleController.listCaptainUpcoming
);

// Compat com FE legado que chama /users/scheduled
router.get(
    '/legacy-users',
    authMiddleware.authUser,
    scheduleController.listMine
);

module.exports = router;
