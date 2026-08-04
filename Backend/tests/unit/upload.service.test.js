const uploadService = require('../../services/upload.service');

// Migração de Firebase Storage para Cloudinary (2026-08-03, docs/plans/): o bucket do
// Firebase Storage nunca existiu de verdade neste projeto (confirmado com upload real
// contra produção, credenciais reais — 404 "specified bucket does not exist", plano
// Spark não provisiona bucket padrão sozinho). Estes testes rodam a lógica REAL de
// upload.service.js (compressão com sharp, montagem de URL, extração de public_id) —
// só a chamada de rede ao Cloudinary é mockada (tests/mocks/cloudinary.mock.js), mesmo
// padrão já usado pro firebase-admin no resto da suíte.

// 1x1 PNG válido — sharp aceita como entrada mesmo saindo como JPEG comprimido.
const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

describe('upload.service (Cloudinary)', () => {
    it('uploadProfileImage: sobe como público (type=upload) na pasta users/profiles', async () => {
        const url = await uploadService.uploadProfileImage(TINY_PNG);
        expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/.*\/image\/upload\/.*users\/profiles\/mock-\d+\.jpg$/);
    });

    it('uploadVehicleImage: sobe como público na pasta captains/vehicles', async () => {
        const url = await uploadService.uploadVehicleImage(TINY_PNG);
        expect(url).toMatch(/\/image\/upload\/.*captains\/vehicles\/mock-\d+\.jpg$/);
    });

    it('uploadDocument: sobe como authenticated (privado) — nunca no formato /image/upload/', async () => {
        const url = await uploadService.uploadDocument(TINY_PNG, 'cnh');
        expect(url).toMatch(/\/image\/authenticated\/.*captains\/documents\/cnh\/mock-\d+\.jpg$/);
        expect(url).not.toContain('/image/upload/');
    });

    it('getSignedDocumentUrl: gera URL assinada de verdade a partir da URL privada salva', async () => {
        const uploadedUrl = await uploadService.uploadDocument(TINY_PNG, 'selfie');
        const signedUrl = await uploadService.getSignedDocumentUrl(uploadedUrl);

        expect(signedUrl).toBeTruthy();
        expect(signedUrl).not.toBe(uploadedUrl);
        // O public_id extraído da URL original tem que bater com a pasta certa — prova
        // que o parsing de volta (extractPublicId) está correto. Não fixamos o número
        // sequencial do mock (mock-N) porque depende da ordem de execução dos testes.
        const cloudinary = require('cloudinary');
        const [publicIdUsed] = cloudinary.v2.utils.private_download_url.mock.calls.at(-1);
        expect(publicIdUsed).toMatch(/^captains\/documents\/selfie\/mock-\d+$/);
    });

    it('getSignedDocumentUrl: sem URL, devolve null sem chamar o Cloudinary', async () => {
        const result = await uploadService.getSignedDocumentUrl(null);
        expect(result).toBeNull();
    });

    it('deleteImage: apaga documento privado com type=authenticated (não type=upload)', async () => {
        const url = await uploadService.uploadDocument(TINY_PNG, 'crlv');
        await uploadService.deleteImage(url);

        const cloudinary = require('cloudinary');
        const [publicIdUsed, options] = cloudinary.v2.uploader.destroy.mock.calls.at(-1);
        expect(publicIdUsed).toMatch(/^captains\/documents\/crlv\/mock-\d+$/);
        expect(options).toMatchObject({ type: 'authenticated' });
    });

    it('deleteImage: apaga foto pública com type=upload', async () => {
        const url = await uploadService.uploadProfileImage(TINY_PNG);
        await uploadService.deleteImage(url);

        const cloudinary = require('cloudinary');
        const [, options] = cloudinary.v2.uploader.destroy.mock.calls.at(-1);
        expect(options).toMatchObject({ type: 'upload' });
    });

    it('deleteImage: sem URL, não lança erro nem chama o Cloudinary', async () => {
        await expect(uploadService.deleteImage(null)).resolves.toBeUndefined();
    });
});
