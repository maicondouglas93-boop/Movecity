const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Adicionar middlewares de auth quando necessário
router.post('/profile', authMiddleware.authUser, uploadController.uploadMiddleware, uploadController.uploadProfile);

router.post('/vehicle', authMiddleware.authCaptain, uploadController.uploadMiddleware, uploadController.uploadVehicle);

router.post('/document', authMiddleware.authCaptain, uploadController.uploadMiddleware, uploadController.uploadDocument);

module.exports = router;
