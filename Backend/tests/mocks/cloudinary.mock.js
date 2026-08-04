const { Writable } = require('stream');

// Mock do SDK do Cloudinary pros testes — mesmo padrão já usado pro firebase-admin
// (tests/mocks/firebase-admin.mock.js): mocka só o SDK do serviço externo, nunca a
// lógica própria (upload.service.js roda de verdade, só a chamada de rede é que não
// sai daqui).
let counter = 0;

const uploader = {
    upload_stream: jest.fn((options, callback) => {
        return new Writable({
            write(_chunk, _encoding, cb) { cb(); },
            final(cb) {
                counter += 1;
                const type = options?.type === 'authenticated' ? 'authenticated' : 'upload';
                const folder = options?.folder || 'test';
                const publicId = `${folder}/mock-${counter}`;
                callback(null, {
                    public_id: publicId,
                    secure_url: `https://res.cloudinary.com/mock-cloud/image/${type}/v1700000000/${publicId}.jpg`,
                });
                cb();
            },
        });
    }),
    destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
};

const utils = {
    private_download_url: jest.fn((publicId) =>
        Promise.resolve(`https://res.cloudinary.com/mock-cloud/image/authenticated/s--mocksig--/${publicId}.jpg?_expires=mock`)
    ),
};

module.exports = {
    v2: {
        config: jest.fn(),
        uploader,
        utils,
    },
};
