// Mock do SDK @imagekit/nodejs — mesmo padrão do firebase-admin / antigo cloudinary:
// a lógica de upload.service.js roda de verdade; só a chamada de rede é stubada.
let counter = 0;

const upload = jest.fn(async (params = {}) => {
    counter += 1;
    const folder = String(params.folder || 'test').replace(/^\/+|\/+$/g, '');
    const fileName = params.fileName || `mock-${counter}.webp`;
    const filePath = `/${folder}/${fileName}`;
    return {
        fileId: `file_${counter}`,
        filePath,
        url: `https://ik.imagekit.io/mock${filePath}`,
        name: fileName,
        isPrivateFile: Boolean(params.isPrivateFile),
    };
});

const deleteFile = jest.fn().mockResolvedValue(undefined);

const buildSrc = jest.fn(({ urlEndpoint = '', src = '', signed, expiresIn } = {}) => {
    const base = `${String(urlEndpoint).replace(/\/$/, '')}${src}`;
    if (signed) {
        return `${base}?ik-t=${expiresIn || 0}&ik-s=mocksig`;
    }
    return base;
});

const list = jest.fn(async ({ searchQuery } = {}) => {
    const match = /path="([^"]+)"/.exec(searchQuery || '');
    if (!match) return [];
    return [{ fileId: 'file_resolved', filePath: match[1] }];
});

function ImageKit() {
    return {
        files: {
            upload,
            delete: deleteFile,
        },
        assets: { list },
        helper: { buildSrc },
    };
}

module.exports = {
    ImageKit,
    default: ImageKit,
    toFile: jest.fn(async (buffer, fileName) => ({ buffer, name: fileName })),
    __mockState: {
        upload,
        deleteFile,
        buildSrc,
        list,
        resetCounter() {
            counter = 0;
        },
    },
};
