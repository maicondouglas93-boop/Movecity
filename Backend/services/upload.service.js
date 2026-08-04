const { Readable } = require('stream');
const sharp = require('sharp');
const cloudinary = require('../config/cloudinary');

// Migração de Firebase Storage para Cloudinary (2026-08-03) — ver
// Backend/config/cloudinary.js para o motivo. Mantém exatamente as mesmas assinaturas
// exportadas (uploadProfileImage, uploadVehicleImage, uploadDocument, deleteImage,
// getSignedDocumentUrl) para não exigir nenhuma mudança em quem já chama este módulo
// (upload.controller.js, admin.service.js).

const uploadBuffer = (buffer, options) => new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) return reject(error);
        resolve(result);
    });
    Readable.from(buffer).pipe(uploadStream);
});

// Cloudinary embute o "tipo" (upload/authenticated) na própria URL entregue
// (.../image/upload/... vs .../image/authenticated/...) — não precisamos guardar isso
// em campo separado no banco, é o mesmo padrão que o Firebase Storage já tinha (a URL
// pública em si nunca revelava nada, e o "tipo" era implícito pela pasta).
const isAuthenticatedUrl = (url) => url.includes('/image/authenticated/');

// Extrai o public_id (identificador estável do Cloudinary, ex: "captains/documents/cnh/<uuid>")
// de volta a partir da URL entregue no upload — funciona tanto pra URL simples quanto
// pra uma URL assinada (que tem um segmento extra "s--assinatura--/").
const extractPublicId = (url) => {
    const { pathname } = new URL(url);
    const marker = isAuthenticatedUrl(url) ? '/authenticated/' : '/upload/';
    let rest = pathname.split(marker)[1];
    if (!rest) throw new Error(`URL do Cloudinary em formato inesperado: ${url}`);
    rest = rest.replace(/^s--[^/]+--\//, ''); // segmento de assinatura, se vier de uma URL já assinada
    rest = rest.replace(/^v\d+\//, ''); // segmento de versão
    rest = rest.replace(/\.[a-zA-Z0-9]+$/, ''); // extensão
    return rest;
};

/**
 * Comprime a imagem com Sharp e envia pro Cloudinary.
 * @param {Buffer} fileBuffer Buffer do arquivo recebido pelo multer
 * @param {string} folder Pasta de destino no Cloudinary (ex: 'users/profiles', 'captains/documents/cnh')
 * @param {boolean} isPublic Se false, sobe como 'authenticated' — só acessível via URL assinada (ver getSignedDocumentUrl)
 * @returns {Promise<string>} URL do arquivo (utilizável direto se pública; só um identificador estável se privada)
 */
const processAndUploadImage = async (fileBuffer, folder, isPublic = true) => {
    try {
        // WebP em vez de JPEG: mesmo nível de qualidade visual, arquivo ~25-35% menor —
        // suporte de sobra em qualquer navegador/dispositivo relevante hoje (iOS Safari
        // 14+, Android, todos os desktops).
        const compressedBuffer = await sharp(fileBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();

        const result = await uploadBuffer(compressedBuffer, {
            folder,
            resource_type: 'image',
            type: isPublic ? 'upload' : 'authenticated',
        });

        return result.secure_url;
    } catch (error) {
        console.error('Erro no upload da imagem:', error);
        throw new Error('Falha ao enviar arquivo');
    }
};

module.exports.uploadProfileImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'users/profiles');
};

module.exports.uploadVehicleImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'captains/vehicles');
};

module.exports.uploadDocument = async (fileBuffer, docType = 'documents') => {
    // Auditoria de segurança (2026-08-02, S9): documentos de identidade (CNH, CRLV,
    // selfie) não podem ficar em URL pública — quem tiver o link acessa sem login.
    return processAndUploadImage(fileBuffer, `captains/documents/${docType}`, false);
};

module.exports.deleteImage = async (fileUrl) => {
    try {
        if (!fileUrl) return;
        const publicId = extractPublicId(fileUrl);
        await cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
            type: isAuthenticatedUrl(fileUrl) ? 'authenticated' : 'upload',
        });
    } catch (error) {
        console.error('Erro ao deletar imagem do Cloudinary:', error);
        // Não lançamos erro para não quebrar fluxos caso o arquivo não exista
    }
};

// Gera uma URL temporária (5 min) para visualizar um documento privado — usada pelo
// painel admin em vez da URL salva no banco, que não é mais publicamente acessível.
module.exports.getSignedDocumentUrl = async (fileUrl) => {
    if (!fileUrl) return null;
    const publicId = extractPublicId(fileUrl);
    return cloudinary.utils.private_download_url(publicId, 'webp', {
        resource_type: 'image',
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    });
};
