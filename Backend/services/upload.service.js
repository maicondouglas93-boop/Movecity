const { getStorage } = require('firebase-admin/storage');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

const bucket = getStorage().bucket();

/**
 * Faz o processamento, compressão e upload da imagem para o Firebase Storage
 * @param {Buffer} fileBuffer O buffer do arquivo recebido pelo multer
 * @param {string} folder A pasta de destino no Storage (ex: 'users', 'captains/documents')
 * @param {boolean} isPublic Se false, o objeto não recebe ACL pública — só é legível via URL assinada (ver getSignedDocumentUrl)
 * @returns {Promise<string>} A URL do arquivo (pública ou apenas identificadora, conforme isPublic)
 */
const processAndUploadImage = async (fileBuffer, folder, isPublic = true) => {
    try {
        // Comprimir imagem com Sharp (focar em JPEG otimizado)
        const compressedBuffer = await sharp(fileBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

        const filename = `${folder}/${uuidv4()}.jpg`;
        const file = bucket.file(filename);

        await file.save(compressedBuffer, {
            metadata: {
                contentType: 'image/jpeg',
                cacheControl: isPublic ? 'public, max-age=31536000' : 'private, max-age=0'
            },
            public: isPublic
        });

        // Retornar a URL pública (O bucket deve estar com permissões de leitura pública, ou usamos getSignedUrl/URL estática)
        return `https://storage.googleapis.com/${bucket.name}/${filename}`;
    } catch (error) {
        console.error('Erro no upload da imagem:', error);
        throw new Error('Falha ao enviar arquivo');
    }
}

const extractFilenameFromUrl = (fileUrl) => {
    const urlObj = new URL(fileUrl);
    return urlObj.pathname.replace(`/${bucket.name}/`, '');
}

module.exports.uploadProfileImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'users/profiles');
}

module.exports.uploadVehicleImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'captains/vehicles');
}

module.exports.uploadDocument = async (fileBuffer, docType = 'documents') => {
    // Auditoria de segurança (2026-08-02, S9): documentos de identidade (CNH, CRLV,
    // selfie) não podem ficar em URL pública — quem tiver o link acessa sem login.
    return processAndUploadImage(fileBuffer, `captains/documents/${docType}`, false);
}

module.exports.deleteImage = async (fileUrl) => {
    try {
        if (!fileUrl) return;
        const filename = extractFilenameFromUrl(fileUrl);

        const file = bucket.file(filename);
        await file.delete();
    } catch (error) {
        console.error('Erro ao deletar imagem do storage:', error);
        // Não lançamos erro para não quebrar fluxos caso o arquivo não exista
    }
}

// Gera uma URL temporária (5 min) para visualizar um documento privado — usada pelo
// painel admin em vez da URL salva no banco, que não é mais publicamente acessível.
module.exports.getSignedDocumentUrl = async (fileUrl) => {
    if (!fileUrl) return null;
    const filename = extractFilenameFromUrl(fileUrl);
    const file = bucket.file(filename);
    const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 5 * 60 * 1000
    });
    return signedUrl;
}
