const express = require('express');
const router = express.Router();
const { body } = require("express-validator")
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/register', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('cpf').isLength({ min: 11, max: 11 }).withMessage('CPF must be 11 digits long'),
    body('phone').matches(/^\+\d{10,15}$/).withMessage('Please enter a valid E.164 phone number')
],
    userController.registerUser
)

router.post('/google-login', userController.googleLogin);

router.post('/login', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
],
    userController.loginUser
)

router.get('/profile', authMiddleware.authUser, userController.getUserProfile)

router.put('/profile',
    authMiddleware.authUser,
    body('firstname').optional().isString().isLength({ min: 2 }).withMessage('Nome deve ter pelo menos 2 caracteres'),
    body('lastname').optional().isString().isLength({ min: 2 }).withMessage('Sobrenome deve ter pelo menos 2 caracteres'),
    body('phone').optional({ values: 'falsy' }).isString(),
    body('cpf').optional({ values: 'falsy' }).isString(),
    body('birthDate').optional({ values: 'falsy' }).isString(),
    body('gender').optional({ values: 'falsy' }).isIn([ 'male', 'female', 'other', '' ]).withMessage('Gênero inválido'),
    userController.updateUserProfile
)

// Sem authUser de propósito: o ponto do refresh é justamente renovar quando o access
// token já expirou. A autenticação aqui é o próprio refresh token.
router.post('/refresh', userController.refreshUserSession)

router.get('/logout', authMiddleware.authUser, userController.logoutUser)

// Lista unificada de corridas/encomendas agendadas (compat FE Scheduled.jsx).
router.get('/scheduled', authMiddleware.authUser, require('../controllers/schedule.controller').listMine)

module.exports = router;