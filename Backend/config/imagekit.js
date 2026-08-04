const { ImageKit } = require('@imagekit/nodejs');

// Migração Cloudinary → ImageKit (2026-08-04): mesmas pastas lógicas
// (users/profiles, captains/...) e mesmas funções em upload.service.js.

let client = null;
let warnedMissing = false;

const getUrlEndpoint = () => (process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, '');
const getPublicKey = () => process.env.IMAGEKIT_PUBLIC_KEY || '';
const getPrivateKey = () => process.env.IMAGEKIT_PRIVATE_KEY || '';

const getClient = () => {
    if (client) return client;
    const urlEndpoint = getUrlEndpoint();
    const publicKey = getPublicKey();
    const privateKey = getPrivateKey();
    if (urlEndpoint && publicKey && privateKey) {
        client = new ImageKit({ privateKey });
        console.log('ImageKit configurado.');
        return client;
    }
    if (!warnedMissing) {
        warnedMissing = true;
        console.warn(
            'AVISO: Credenciais do ImageKit não encontradas (IMAGEKIT_URL_ENDPOINT/PUBLIC_KEY/PRIVATE_KEY). Upload de imagens não vai funcionar.'
        );
    }
    return null;
};

module.exports = {
    get client() {
        return getClient();
    },
    get urlEndpoint() {
        return getUrlEndpoint();
    },
    get publicKey() {
        return getPublicKey();
    },
    isConfigured: () => Boolean(getClient() && getUrlEndpoint()),
};
