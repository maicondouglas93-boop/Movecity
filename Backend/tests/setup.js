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
