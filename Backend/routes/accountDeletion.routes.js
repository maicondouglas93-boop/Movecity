const express = require('express');
const { body } = require('express-validator');
const accountDeletionController = require('../controllers/accountDeletion.controller');
const { accountDeletionLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/request', accountDeletionLimiter, [
    body('email').isEmail().normalizeEmail().withMessage('Informe um e-mail válido.'),
    body('accountType').isIn(['user', 'captain']).withMessage('Selecione passageiro ou motorista.'),
], accountDeletionController.requestPublic);

module.exports = router;
