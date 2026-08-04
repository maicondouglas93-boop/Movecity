const sharp = require('sharp');
const { randomUUID } = require('crypto');
const { toFile } = require('@imagekit/nodejs');
const imagekitConfig = require('../config/imagekit');

// Migração Cloudinary → ImageKit (2026-08-04). Mantém as mesmas assinaturas
// exportadas (uploadProfileImage, uploadCaptainProfileImage, uploadVehicleImage,
// uploadDocument, deleteImage, getSignedDocumentUrl) para não exigir mudança em
// upload.controller.js / admin.service.js.

const FILE_ID_PARAM = 'ik-fileId';
const PRIVATE_PARAM = 'ik-private';

const requireClient = () => {
    if (!imagekitConfig.isConfigured()) {
        throw new Error('ImageKit não configurado');
    }
    return imagekitConfig.client;
};

/** Extrai o filePath da Media Library a partir da URL CDN (com ou sem query). */
const extractFilePath = (url) => {
    const { pathname } = new URL(url);
    const endpointPath = new URL(imagekitConfig.urlEndpoint).pathname.replace(/\/$/, '');
    let filePath = pathname;
    if (endpointPath && filePath.startsWith(endpointPath)) {
        filePath = filePath.slice(endpointPath.length) || '/';
    }
    if (!filePath.startsWith('/')) filePath = `/${filePath}`;
    // Remove prefixo de transformação no path (tr:w-100,...) se existir.
    filePath = filePath.replace(/^\/tr:[^/]+/, '');
    if (!filePath || filePath === '/') {
        throw new Error(`URL do ImageKit em formato inesperado: ${url}`);
    }
    return filePath;
};

const extractFileId = (url) => {
    try {
        return new URL(url).searchParams.get(FILE_ID_PARAM);
    } catch {
        return null;
    }
};

const isPrivateStoredUrl = (url) => {
    try {
        return new URL(url).searchParams.get(PRIVATE_PARAM) === '1';
    } catch {
        return false;
    }
};

const attachMeta = (cdnUrl, { fileId, isPrivate }) => {
    const u = new URL(cdnUrl);
    if (fileId) u.searchParams.set(FILE_ID_PARAM, fileId);
    if (isPrivate) u.searchParams.set(PRIVATE_PARAM, '1');
    return u.toString();
};

/**
 * Comprime a imagem com Sharp e envia pro ImageKit.
 * @param {Buffer} fileBuffer Buffer do arquivo recebido pelo multer
 * @param {string} folder Pasta de destino (ex: 'users/profiles', 'captains/documents/cnh')
 * @param {boolean} isPublic Se false, marca isPrivateFile — só acessível via URL assinada
 * @returns {Promise<string>} URL do arquivo (com ik-fileId na query para delete)
 */
const processAndUploadImage = async (fileBuffer, folder, isPublic = true) => {
    try {
        const ik = requireClient();

        const compressedBuffer = await sharp(fileBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();

        const fileName = `${randomUUID()}.webp`;
        const file = await toFile(compressedBuffer, fileName, { type: 'image/webp' });

        const result = await ik.files.upload({
            file,
            fileName,
            folder,
            isPrivateFile: !isPublic,
            responseFields: ['isPrivateFile'],
        });

        if (!result?.url || !result?.fileId) {
            throw new Error('Resposta do ImageKit sem url/fileId');
        }

        return attachMeta(result.url, {
            fileId: result.fileId,
            isPrivate: !isPublic,
        });
    } catch (error) {
        console.error('Erro no upload da imagem:', error);
        throw new Error('Falha ao enviar arquivo');
    }
};

module.exports.uploadProfileImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'users/profiles');
};

module.exports.uploadCaptainProfileImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'captains/profiles');
};

module.exports.uploadVehicleImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'captains/vehicles');
};

module.exports.uploadDocument = async (fileBuffer, docType = 'documents') => {
    // Auditoria de segurança (2026-08-02, S9): documentos de identidade (CNH, CRLV,
    // selfie) não podem ficar em URL pública — quem tiver o link acessa sem login.
    return processAndUploadImage(fileBuffer, `captains/documents/${docType}`, false);
};

const resolveFileId = async (fileUrl) => {
    const embedded = extractFileId(fileUrl);
    if (embedded) return embedded;

    const ik = requireClient();
    const filePath = extractFilePath(fileUrl);
    const results = await ik.assets.list({
        searchQuery: `path="${filePath}"`,
        limit: 1,
    });
    const hit = Array.isArray(results) ? results[0] : null;
    return hit?.fileId || null;
};

module.exports.deleteImage = async (fileUrl) => {
    try {
        if (!fileUrl) return;
        if (!imagekitConfig.isConfigured()) return;
        const fileId = await resolveFileId(fileUrl);
        if (!fileId) {
            console.error('Erro ao deletar imagem do ImageKit: fileId não encontrado', fileUrl);
            return;
        }
        await imagekitConfig.client.files.delete(fileId);
    } catch (error) {
        console.error('Erro ao deletar imagem do ImageKit:', error);
        // Não lançamos erro para não quebrar fluxos caso o arquivo não exista
    }
};

// Gera uma URL temporária (5 min) para visualizar um documento privado — usada pelo
// painel admin em vez da URL salva no banco, que não é mais publicamente acessível.
module.exports.getSignedDocumentUrl = async (fileUrl) => {
    if (!fileUrl) return null;
    const ik = requireClient();
    const filePath = extractFilePath(fileUrl);
    return ik.helper.buildSrc({
        urlEndpoint: imagekitConfig.urlEndpoint,
        src: filePath,
        signed: true,
        expiresIn: 5 * 60,
    });
};

// Exportados só para testes unitários (não usados pelos controllers).
module.exports._test = {
    extractFilePath,
    extractFileId,
    isPrivateStoredUrl,
    FILE_ID_PARAM,
    PRIVATE_PARAM,
};
