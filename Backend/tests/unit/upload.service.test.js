process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/mock';
process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';

const uploadService = require('../../services/upload.service');
const imagekitMock = require('@imagekit/nodejs');

// Migração Cloudinary → ImageKit (2026-08-04): lógica REAL de upload.service.js
// (sharp + montagem de URL); só o SDK ImageKit é mockado.

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

describe('upload.service (ImageKit)', () => {
    beforeEach(() => {
        imagekitMock.__mockState.resetCounter();
        jest.clearAllMocks();
    });

    it('uploadProfileImage: sobe como público na pasta users/profiles, em WebP', async () => {
        const url = await uploadService.uploadProfileImage(TINY_PNG);
        expect(url).toMatch(/^https:\/\/ik\.imagekit\.io\/mock\/users\/profiles\/.+\.webp\?/);
        expect(url).toContain('ik-fileId=');
        expect(url).not.toContain('ik-private=1');
        expect(imagekitMock.__mockState.upload).toHaveBeenCalledWith(
            expect.objectContaining({
                folder: 'users/profiles',
                isPrivateFile: false,
            })
        );
    });

    it('uploadVehicleImage: sobe como público na pasta captains/vehicles', async () => {
        const url = await uploadService.uploadVehicleImage(TINY_PNG);
        expect(url).toMatch(/\/captains\/vehicles\/.+\.webp/);
        expect(imagekitMock.__mockState.upload.mock.calls.at(-1)[0]).toMatchObject({
            folder: 'captains/vehicles',
            isPrivateFile: false,
        });
    });

    it('uploadDocument: sobe como privado (isPrivateFile) — nunca sem ik-private', async () => {
        const url = await uploadService.uploadDocument(TINY_PNG, 'cnh');
        expect(url).toMatch(/\/captains\/documents\/cnh\/.+\.webp/);
        expect(url).toContain('ik-private=1');
        expect(imagekitMock.__mockState.upload.mock.calls.at(-1)[0]).toMatchObject({
            folder: 'captains/documents/cnh',
            isPrivateFile: true,
        });
    });

    it('getSignedDocumentUrl: gera URL assinada a partir da URL privada salva', async () => {
        const uploadedUrl = await uploadService.uploadDocument(TINY_PNG, 'selfie');
        const signedUrl = await uploadService.getSignedDocumentUrl(uploadedUrl);

        expect(signedUrl).toBeTruthy();
        expect(signedUrl).not.toBe(uploadedUrl);
        expect(signedUrl).toContain('ik-s=mocksig');

        const [opts] = imagekitMock.__mockState.buildSrc.mock.calls.at(-1);
        expect(opts.src).toMatch(/^\/captains\/documents\/selfie\/.+\.webp$/);
        expect(opts.signed).toBe(true);
        expect(opts.expiresIn).toBe(300);
    });

    it('getSignedDocumentUrl: sem URL, devolve null sem chamar o ImageKit', async () => {
        const result = await uploadService.getSignedDocumentUrl(null);
        expect(result).toBeNull();
        expect(imagekitMock.__mockState.buildSrc).not.toHaveBeenCalled();
    });

    it('deleteImage: apaga documento privado usando fileId embutido na URL', async () => {
        const url = await uploadService.uploadDocument(TINY_PNG, 'crlv');
        await uploadService.deleteImage(url);

        const fileId = new URL(url).searchParams.get('ik-fileId');
        expect(imagekitMock.__mockState.deleteFile).toHaveBeenCalledWith(fileId);
    });

    it('deleteImage: apaga foto pública usando fileId embutido na URL', async () => {
        const url = await uploadService.uploadProfileImage(TINY_PNG);
        await uploadService.deleteImage(url);

        const fileId = new URL(url).searchParams.get('ik-fileId');
        expect(imagekitMock.__mockState.deleteFile).toHaveBeenCalledWith(fileId);
    });

    it('deleteImage: sem URL, não lança erro nem chama o ImageKit', async () => {
        await expect(uploadService.deleteImage(null)).resolves.toBeUndefined();
        expect(imagekitMock.__mockState.deleteFile).not.toHaveBeenCalled();
    });
});
