const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// Rota para receber webhooks do Asaas
router.post('/asaas', webhookController.handleAsaasWebhook);

module.exports = router;
