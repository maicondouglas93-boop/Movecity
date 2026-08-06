const express = require('express');
const router = express.Router();
const driverAppVersionController = require('../controllers/driverAppVersion.controller');

// Público (somente leitura) — APK consulta sem auth para checar update no boot.
router.get('/driver', driverAppVersionController.getDriverAppVersion);

module.exports = router;
