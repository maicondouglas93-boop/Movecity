const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let mongoServer;

// Replica set de 1 nó (não um standalone) — necessário pra mongoose.startSession() +
// transações funcionarem nos testes. Sem isso, qualquer código que abre uma transação
// (ex.: confirmPaymentReceived, P1.1 da auditoria de concorrência) falha em CI com
// "Transaction numbers are only allowed on a replica set member or mongos", mesmo
// estando correto — o ambiente de teste não refletiria o Atlas real (que já é replica set).
module.exports.connect = async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = mongoServer.getUri();

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
};

module.exports.closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
};

module.exports.clearDatabase = async () => {
  if (mongoose.connection.readyState === 0) return;
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany();
  }
};
