const captainController = require('../controllers/captain.controller');
const express = require('express');
const router = express.Router();
const { body } = require("express-validator")
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/register', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('vehicle.color').isLength({ min: 3 }).withMessage('Color must be at least 3 characters long'),
    body('vehicle.plate').isLength({ min: 3 }).withMessage('Plate must be at least 3 characters long'),
    body('vehicle.capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
    body('vehicle.vehicleType').isIn([ 'car', 'motorcycle', 'auto' ]).withMessage('Invalid vehicle type')
],
    captainController.registerCaptain
)


router.post('/login', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
],
    captainController.loginCaptain
)


router.get('/profile', authMiddleware.authCaptain, captainController.getCaptainProfile)

router.get('/logout', authMiddleware.authCaptain, captainController.logoutCaptain)

router.get('/wallet', authMiddleware.authCaptain, captainController.getWallet)
router.get('/transactions', authMiddleware.authCaptain, captainController.getTransactions)
router.get('/summary', authMiddleware.authCaptain, captainController.getSummary)

router.post('/recharge', 
    authMiddleware.authCaptain,
    body('amount').isNumeric().withMessage('Amount must be a number'),
    captainController.rechargeWallet
)

router.post('/toggle-online',
    authMiddleware.authCaptain,
    body('isOnline').isBoolean().withMessage('isOnline must be a boolean'),
    captainController.toggleOnline
)

module.exports = router;