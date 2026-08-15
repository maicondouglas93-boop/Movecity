process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET || 'test-admin-secret';
process.env.JWT_SHARE_SECRET = process.env.JWT_SHARE_SECRET || 'test-share-secret';
process.env.JWT_ACCEPT_LEGACY_TOKENS = 'true';
process.env.JWT_LEGACY_ACCEPT_UNTIL = '2099-01-01T00:00:00.000Z';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let mongoServer;

// Start memory server before all tests
// Replica set de 1 nó (não standalone) — necessário pra mongoose.startSession() +
// transações funcionarem (ex.: confirmPaymentReceived em ride.service.js). Standalone
// falha com "Transaction numbers are only allowed on a replica set member or mongos".
// Mesmo motivo/solução já usada em tests/setup/testDatabase.js (suíte Jest).
beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const mongoUri = mongoServer.getUri();
    
    // Connect mongoose to the memory server
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
});

// Clean up database after each test
afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        const collection = collections[key];
        await collection.deleteMany({});
    }

    // Auditoria de cache (2026-08-08): Backend/cache/cache.js é uma instância única
    // de NodeCache por processo — sem limpar aqui, um teste que recria um documento
    // (ex.: VehicleCategory com o mesmo `name`) com configuração diferente do teste
    // anterior recebia de volta o valor cacheado do teste anterior, não o que acabou
    // de semear. Descoberto pelos testes de pricingEngine.service.js quebrando depois
    // da auditoria de cache adicionar cache-aside em VehicleCategory/GlobalSetting.
    const { clearCache } = require('../cache/cache');
    clearCache();
});

// Disconnect and stop memory server after all tests
afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    if (mongoServer) {
        await mongoServer.stop();
    }
});
