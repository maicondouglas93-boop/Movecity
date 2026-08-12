const multer = require('multer');
const express = require('express');
const uploadService = require('../services/upload.service');
const userModel = require('../models/user.model');
const captainModel = require('../models/captain.model');
const { deleteCache } = require('../cache/cache');

// Usar o armazenamento em memória para processar a imagem com Sharp depois
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

const DOCUMENT_TYPES = new Set(['cnhFront', 'cnhBack', 'crlv', 'vehicleFront', 'selfie']);

module.exports.uploadMiddleware = upload.single('image');

const rawImageUpload = express.raw({
    type: 'application/octet-stream',
    limit: '5mb',
});

// O APK envia imagens como bytes puros para não depender da serialização multipart
// do WebView Android. Converte o erro de limite em resposta útil, sem deixar o
// error handler global transformá-lo em 500.
module.exports.imageBinaryMiddleware = (req, res, next) => {
    rawImageUpload(req, res, (err) => {
        if (err?.type === 'entity.too.large') {
            return res.status(413).json({ message: 'A foto deve ter no máximo 5 MB.' });
        }
        if (err) return next(err);
        return next();
    });
};
module.exports.documentBinaryMiddleware = module.exports.imageBinaryMiddleware;

const requireBinaryImage = (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ message: 'Nenhuma imagem enviada' });
        return null;
    }
    return req.body;
};

module.exports.uploadProfile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhuma imagem enviada' });
        }

        const url = await uploadService.uploadProfileImage(req.file.buffer);

        // Persiste no user — antes só subia pro storage e o front ficava com stub.
        const user = await userModel.findByIdAndUpdate(
            req.user._id,
            { profilePicture: url },
            { new: true }
        );
        deleteCache(`profile:user:${req.user._id}`);

        res.status(200).json({
            url,
            user,
            message: 'Upload concluído com sucesso',
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro ao fazer upload da imagem', error: err.message });
    }
};

module.exports.uploadProfileBinary = async (req, res) => {
    try {
        const fileBuffer = requireBinaryImage(req, res);
        if (!fileBuffer) return;

        const url = await uploadService.uploadProfileImage(fileBuffer);
        const user = await userModel.findByIdAndUpdate(
            req.user._id,
            { profilePicture: url },
            { new: true }
        );
        deleteCache(`profile:user:${req.user._id}`);

        return res.status(200).json({
            url,
            user,
            message: 'Upload concluído com sucesso',
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Erro ao fazer upload da imagem', error: err.message });
    }
};

module.exports.uploadCaptainProfile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhuma imagem enviada' });
        }

        const url = await uploadService.uploadCaptainProfileImage(req.file.buffer);

        const captain = await captainModel.findByIdAndUpdate(
            req.captain._id,
            { profilePicture: url },
            { new: true }
        );
        deleteCache(`profile:captain:${req.captain._id}`);

        res.status(200).json({
            url,
            captain,
            message: 'Upload concluído com sucesso',
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro ao fazer upload da imagem', error: err.message });
    }
};

module.exports.uploadCaptainProfileBinary = async (req, res) => {
    try {
        const fileBuffer = requireBinaryImage(req, res);
        if (!fileBuffer) return;

        const url = await uploadService.uploadCaptainProfileImage(fileBuffer);
        const captain = await captainModel.findByIdAndUpdate(
            req.captain._id,
            { profilePicture: url },
            { new: true }
        );
        deleteCache(`profile:captain:${req.captain._id}`);

        return res.status(200).json({
            url,
            captain,
            message: 'Upload concluído com sucesso',
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Erro ao fazer upload da imagem', error: err.message });
    }
};

module.exports.uploadVehicle = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhuma imagem enviada' });
        }

        const url = await uploadService.uploadVehicleImage(req.file.buffer);
        res.status(200).json({ url, message: 'Upload concluído com sucesso' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro ao fazer upload da imagem', error: err.message });
    }
};

module.exports.uploadDocument = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhuma imagem enviada' });
        }

        const { docType } = req.body; // ex: 'cnh', 'crlv'
        const url = await uploadService.uploadDocument(req.file.buffer, docType || 'geral');
        res.status(200).json({ url, message: 'Upload concluído com sucesso' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro ao fazer upload do documento', error: err.message });
    }
};

module.exports.uploadDocumentBinary = async (req, res) => {
    try {
        const fileBuffer = requireBinaryImage(req, res);
        if (!fileBuffer) return;

        const { docType } = req.query;
        if (!DOCUMENT_TYPES.has(docType)) {
            return res.status(400).json({ message: 'Tipo de documento inválido' });
        }

        const url = await uploadService.uploadDocument(fileBuffer, docType);
        return res.status(200).json({ url, message: 'Upload concluído com sucesso' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Erro ao fazer upload do documento', error: err.message });
    }
};
