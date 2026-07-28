const { getStorage } = require('firebase-admin/storage');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

const bucket = getStorage().bucket();

/**
 * Faz o processamento, compressão e upload da imagem para o Firebase Storage
 * @param {Buffer} fileBuffer O buffer do arquivo recebido pelo multer
 * @param {string} folder A pasta de destino no Storage (ex: 'users', 'captains/documents')
 * @returns {Promise<string>} A URL pública do arquivo
 */
const processAndUploadImage = async (fileBuffer, folder) => {
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
                cacheControl: 'public, max-age=31536000'
            },
            public: true
        });

        // Retornar a URL pública (O bucket deve estar com permissões de leitura pública, ou usamos getSignedUrl/URL estática)
        return `https://storage.googleapis.com/${bucket.name}/${filename}`;
    } catch (error) {
        console.error('Erro no upload da imagem:', error);
        throw new Error('Falha ao enviar arquivo');
    }
}

module.exports.uploadProfileImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'users/profiles');
}

module.exports.uploadVehicleImage = async (fileBuffer) => {
    return processAndUploadImage(fileBuffer, 'captains/vehicles');
}

module.exports.uploadDocument = async (fileBuffer, docType = 'documents') => {
    return processAndUploadImage(fileBuffer, `captains/documents/${docType}`);
}

module.exports.deleteImage = async (fileUrl) => {
    try {
        if (!fileUrl) return;
        const urlObj = new URL(fileUrl);
        const filename = urlObj.pathname.replace(`/${bucket.name}/`, '');
        
        const file = bucket.file(filename);
        await file.delete();
    } catch (error) {
        console.error('Erro ao deletar imagem do storage:', error);
        // Não lançamos erro para não quebrar fluxos caso o arquivo não exista
    }
}
