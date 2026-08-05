const captainController = require('../controllers/captain.controller');
const express = require('express');
const router = express.Router();
const { body } = require("express-validator")
const authMiddleware = require('../middlewares/auth.middleware');

// Placa: cobre formato antigo (ABC1234) e Mercosul (ABC1D23) — o sistema nunca teve
// validação de formato além de minlength:3, então esta é a primeira, não uma
// substituição de uma convenção existente. Aceita com espaços/traço (o
// customSanitizer normaliza antes da checagem).
const PLATE_REGEX = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;
const normalizePlate = (value) => typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : value;

// Simplificação do cadastro do motorista (2026-08-04): cadastro inicial pede só conta
// (email/senha) + veículo. CPF, telefone, data de nascimento, CNH e PIX saem daqui —
// passam a ser coletados na etapa de documentação (ver PATCH /captains/document-info),
// sem bloquear a criação da conta. capacity não é mais pedido ao motorista: vem da
// categoria escolhida (vehicleCategory.capacity), evitando duplicar esse dado.
router.post('/register', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('vehicle.marca').isString().notEmpty().withMessage('Vehicle brand is required'),
    body('vehicle.modelo').isString().notEmpty().withMessage('Vehicle model is required'),
    body('vehicle.ano').isInt({ min: 1950 }).withMessage('Vehicle year is required'),
    body('vehicle.color').isLength({ min: 3 }).withMessage('Color must be at least 3 characters long'),
    body('vehicle.plate').customSanitizer(normalizePlate).matches(PLATE_REGEX).withMessage('Invalid plate format'),
    body('vehicle.vehicleType').isString().notEmpty().withMessage('Invalid vehicle type')
],
    captainController.registerCaptain
)

// Coleta de CNH e PIX (2026-08-04): movidos do cadastro inicial para a etapa de
// documentação — o motorista preenche isso junto do envio dos documentos, não antes.
// Todos os campos são opcionais aqui (envio parcial é permitido: só CNH, só PIX, ou os
// dois); o que vier é validado e gravado, o resto permanece como estava.
router.patch('/document-info', [
    authMiddleware.authCaptain,
    body('cnh.number').optional().isString().notEmpty().withMessage('CNH number is required'),
    body('cnh.category').optional().isString().notEmpty().withMessage('CNH category is required'),
    body('cnh.expiration').optional().isISO8601().withMessage('Valid CNH expiration date is required'),
    body('cnh.uf').optional().isString(),
    body('cnh.ear').optional().isBoolean(),
    body('pix.keyType').optional().isIn(['cpf', 'celular', 'email', 'aleatoria']).withMessage('Invalid PIX key type'),
    body('pix.key').optional().isString().notEmpty().withMessage('PIX key is required'),
],
    captainController.updateDocumentInfo
)


router.post('/login', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
],
    captainController.loginCaptain
)


router.get('/profile', authMiddleware.authCaptain, captainController.getCaptainProfile)

// Sem authCaptain de propósito — ver o comentário equivalente em user.routes.js.
router.post('/refresh', captainController.refreshCaptainSession)

router.patch('/documents',
    authMiddleware.authCaptain,
    body('docType').isIn(['cnhFront', 'cnhBack', 'crlv', 'vehicleFront', 'selfie']).withMessage('Invalid document type'),
    body('url').isURL().withMessage('Invalid URL'),
    captainController.updateDocument
)

router.get('/logout', authMiddleware.authCaptain, captainController.logoutCaptain)

router.get('/wallet', authMiddleware.authCaptain, captainController.getWallet)
router.get('/transactions', authMiddleware.authCaptain, captainController.getTransactions)
router.post('/payouts', authMiddleware.authCaptain, captainController.requestPayout)
router.get('/summary', authMiddleware.authCaptain, captainController.getSummary)
router.get('/earnings', authMiddleware.authCaptain, captainController.getEarnings)

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

router.get(
    '/scheduled-upcoming',
    authMiddleware.authCaptain,
    require('../controllers/schedule.controller').listCaptainUpcoming
)

module.exports = router;