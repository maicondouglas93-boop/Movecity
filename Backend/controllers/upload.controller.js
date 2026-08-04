const multer = require('multer');
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

module.exports.uploadMiddleware = upload.single('image');

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
