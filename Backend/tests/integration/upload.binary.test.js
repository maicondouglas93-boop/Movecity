const express = require('express');
const request = require('supertest');

jest.mock('../../middlewares/auth.middleware', () => ({
    authUser: (req, _res, next) => {
        req.user = { _id: 'user-test' };
        next();
    },
    authCaptain: (req, _res, next) => {
        req.captain = { _id: 'captain-test' };
        next();
    },
}));

jest.mock('../../services/upload.service', () => ({
    uploadDocument: jest.fn(),
    uploadProfileImage: jest.fn(),
    uploadCaptainProfileImage: jest.fn(),
}));
jest.mock('../../models/user.model', () => ({
    findByIdAndUpdate: jest.fn(),
}));
jest.mock('../../models/captain.model', () => ({
    findByIdAndUpdate: jest.fn(),
}));

const uploadService = require('../../services/upload.service');
const userModel = require('../../models/user.model');
const captainModel = require('../../models/captain.model');
const uploadRoutes = require('../../routes/upload.routes');

describe('POST /uploads/document-binary', () => {
    const app = express();
    app.use('/uploads', uploadRoutes);

    beforeEach(() => {
        jest.clearAllMocks();
        uploadService.uploadDocument.mockResolvedValue('https://storage.test/private.webp');
        uploadService.uploadProfileImage.mockResolvedValue('https://storage.test/user.webp');
        uploadService.uploadCaptainProfileImage.mockResolvedValue('https://storage.test/captain.webp');
        userModel.findByIdAndUpdate.mockResolvedValue({ _id: 'user-test', profilePicture: 'https://storage.test/user.webp' });
        captainModel.findByIdAndUpdate.mockResolvedValue({ _id: 'captain-test', profilePicture: 'https://storage.test/captain.webp' });
    });

    it('recebe os bytes do APK sem multipart e preserva o docType', async () => {
        const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

        const response = await request(app)
            .post('/uploads/document-binary?docType=cnhBack')
            .set('Content-Type', 'application/octet-stream')
            .send(imageBytes);

        expect(response.status).toBe(200);
        expect(response.body.url).toBe('https://storage.test/private.webp');
        expect(uploadService.uploadDocument).toHaveBeenCalledTimes(1);
        expect(uploadService.uploadDocument.mock.calls[0][0]).toEqual(imageBytes);
        expect(uploadService.uploadDocument.mock.calls[0][1]).toBe('cnhBack');
    });

    it('recusa corpo binário vazio', async () => {
        const response = await request(app)
            .post('/uploads/document-binary?docType=crlv')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.alloc(0));

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Nenhuma imagem enviada');
        expect(uploadService.uploadDocument).not.toHaveBeenCalled();
    });

    it('recusa tipo de documento fora da lista permitida', async () => {
        const response = await request(app)
            .post('/uploads/document-binary?docType=../../arquivo')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from([1, 2, 3]));

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Tipo de documento inválido');
        expect(uploadService.uploadDocument).not.toHaveBeenCalled();
    });

    it('recusa imagem maior que 5 MB antes do serviço de armazenamento', async () => {
        const response = await request(app)
            .post('/uploads/document-binary?docType=selfie')
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.alloc((5 * 1024 * 1024) + 1, 1));

        expect(response.status).toBe(413);
        expect(response.body.message).toBe('A foto deve ter no máximo 5 MB.');
        expect(uploadService.uploadDocument).not.toHaveBeenCalled();
    });

    it('recebe a foto de perfil do motorista como bytes e persiste a URL', async () => {
        const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

        const response = await request(app)
            .post('/uploads/captain-profile-binary')
            .set('Content-Type', 'application/octet-stream')
            .send(imageBytes);

        expect(response.status).toBe(200);
        expect(response.body.url).toBe('https://storage.test/captain.webp');
        expect(uploadService.uploadCaptainProfileImage).toHaveBeenCalledWith(imageBytes);
        expect(captainModel.findByIdAndUpdate).toHaveBeenCalledWith(
            'captain-test',
            { profilePicture: 'https://storage.test/captain.webp' },
            { new: true }
        );
    });

    it('recebe a foto de perfil do passageiro como bytes e persiste a URL', async () => {
        const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

        const response = await request(app)
            .post('/uploads/profile-binary')
            .set('Content-Type', 'application/octet-stream')
            .send(imageBytes);

        expect(response.status).toBe(200);
        expect(response.body.url).toBe('https://storage.test/user.webp');
        expect(uploadService.uploadProfileImage).toHaveBeenCalledWith(imageBytes);
        expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
            'user-test',
            { profilePicture: 'https://storage.test/user.webp' },
            { new: true }
        );
    });
});
