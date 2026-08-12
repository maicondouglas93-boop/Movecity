const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/profile', authMiddleware.authUser, uploadController.uploadMiddleware, uploadController.uploadProfile);

router.post('/captain-profile', authMiddleware.authCaptain, uploadController.uploadMiddleware, uploadController.uploadCaptainProfile);

router.post('/vehicle', authMiddleware.authCaptain, uploadController.uploadMiddleware, uploadController.uploadVehicle);

router.post('/document', authMiddleware.authCaptain, uploadController.uploadMiddleware, uploadController.uploadDocument);

router.post(
    '/document-binary',
    authMiddleware.authCaptain,
    uploadController.documentBinaryMiddleware,
    uploadController.uploadDocumentBinary
);

module.exports = router;
