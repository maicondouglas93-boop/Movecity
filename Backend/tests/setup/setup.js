process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
require('dotenv').config();
const mongoose = require('mongoose');
const { connect, closeDatabase, clearDatabase } = require('./testDatabase');

// Global setup
beforeAll(async () => {
    // Disable external logging during tests to keep console clean, unless debugging
    // console.log = jest.fn();
    // console.info = jest.fn();
    
    // Configura Mocks Globais para garantir que APIs externas não sejam chamadas
    jest.mock('firebase-admin', () => ({
        initializeApp: jest.fn(),
        credential: {
            cert: jest.fn(),
        }
    }));
    jest.mock('firebase-admin/auth', () => ({
        getAuth: jest.fn(() => ({
            verifyIdToken: jest.fn().mockResolvedValue({ uid: 'firebase_mock_uid', email: 'mock@test.com' })
        }))
    }));
    jest.mock('../../services/maps.service'); // Deve ter um __mocks__ ou definiremos manualmente
    jest.mock('../../services/asaas.service', () => ({
        createCustomer: jest.fn().mockResolvedValue({ id: 'cus_mock123' }),
        createPixCharge: jest.fn().mockResolvedValue({ invoiceUrl: 'http://mock.pix', payload: 'mock_payload' }),
        createCreditCardCharge: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
        createTransfer: jest.fn().mockResolvedValue({ status: 'PENDING' }),
        checkPaymentStatus: jest.fn().mockResolvedValue({ status: 'RECEIVED' })
    }));
    
    await connect();

    // O índice único parcial de ride.model.js (impede um motorista de ter duas corridas
    // ativas — P2.1 da auditoria de concorrência) só existe de fato no Mongo depois de
    // `syncIndexes()`; sem esperar aqui, os primeiros testes rodam antes do índice
    // existir e a constraint não pega. Escopado só ao model `ride` de propósito: alguns
    // outros models (ex. user) têm uma declaração de índice duplicada pré-existente
    // (`unique:true` no campo + um `schema.index()` separado pro mesmo campo — já avisado
    // pelo Mongoose como warning) que faz `syncIndexes()` falhar por conflito de nome.
    // Corrigir isso é um problema separado, fora do escopo desta etapa. E só chama se o
    // model já foi registrado — arquivos de teste que não importam ride.model.js (ex.:
    // pricingEngine, tariffScheduler) nem têm o schema carregado nesta suíte.
    if (mongoose.modelNames().includes('ride')) {
        await mongoose.model('ride').syncIndexes();
    }

    // Auditoria PWA (2026-08-03, B10): mesmo motivo do bloco acima, agora pro índice
    // 2dsphere de `locationGeoJSON` (captain.model.js) — sem ele, a primeira query
    // `$nearSphere` de um arquivo de teste (ex.: captain.availability.test.js) roda
    // antes do índice existir e falha com "unable to find index for $geoNear query".
    // `captain.model.js` não tem o problema de índice duplicado que bloqueia isto pra
    // `user` (só `ride` foi checado antes) — confirmado sem `schema.index()` repetindo
    // um campo que já é `unique: true`.
    if (mongoose.modelNames().includes('captain')) {
        await mongoose.model('captain').syncIndexes();
    }

    // Índice parcial rideId/parcelId+$type:objectId — sem syncIndexes, bases (e o
    // memory server se um teste criou o índice legado) mantêm o filtro antigo que
    // indexava rideId:null e gerava E11000 na 2ª comissão de encomenda.
    if (mongoose.modelNames().includes('transaction')) {
        await mongoose.model('transaction').syncIndexes();
    }

    if (mongoose.modelNames().includes('notification')) {
        await mongoose.model('notification').syncIndexes();
    }
});

afterEach(async () => {
    await clearDatabase();
    jest.clearAllMocks();

    // Auditoria de cache (2026-08-08): mesmo motivo do afterEach equivalente em
    // tests/setup.js (Vitest) — Backend/cache/cache.js é uma instância única por
    // processo, não por teste; sem limpar aqui um teste que recria um documento com
    // o mesmo identificador (ex.: VehicleCategory) recebe de volta o valor cacheado
    // do teste anterior.
    const { clearCache } = require('../../cache/cache');
    clearCache();
});

afterAll(async () => {
    await closeDatabase();
});
