const captainController = require('../controllers/captain.controller');
const express = require('express');
const router = express.Router();
const { body } = require("express-validator")
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/register', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('cpf').isLength({ min: 11, max: 11 }).withMessage('CPF must be 11 digits long'),
    body('phone').matches(/^\+\d{10,15}$/).withMessage('Please enter a valid E.164 phone number'),
    body('birthDate').isISO8601().withMessage('Valid birth date is required'),
    body('cnh.number').isString().notEmpty().withMessage('CNH number is required'),
    body('cnh.category').isString().notEmpty().withMessage('CNH category is required'),
    body('cnh.expiration').isISO8601().withMessage('Valid CNH expiration date is required'),
    body('pix.keyType').isIn(['cpf', 'celular', 'email', 'aleatoria']).withMessage('Invalid PIX key type'),
    body('pix.key').isString().notEmpty().withMessage('PIX key is required'),
    body('vehicle.marca').isString().notEmpty().withMessage('Vehicle brand is required'),
    body('vehicle.modelo').isString().notEmpty().withMessage('Vehicle model is required'),
    body('vehicle.ano').isInt().withMessage('Vehicle year is required'),
    body('vehicle.color').isLength({ min: 3 }).withMessage('Color must be at least 3 characters long'),
    body('vehicle.plate').isLength({ min: 3 }).withMessage('Plate must be at least 3 characters long'),
    body('vehicle.capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
    body('vehicle.vehicleType').isString().notEmpty().withMessage('Invalid vehicle type')
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

router.patch('/documents',
    authMiddleware.authCaptain,
    body('docType').isIn(['cnhFront', 'cnhBack', 'crlv', 'vehicleFront', 'selfie']).withMessage('Invalid document type'),
    body('url').isURL().withMessage('Invalid URL'),
    captainController.updateDocument
)

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