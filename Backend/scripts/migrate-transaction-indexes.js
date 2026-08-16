const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

// Plano de correção (Fase 2.2, 2026-08-16): isto rodava automaticamente em todo boot
// (db/db.js), sem versionamento nem log de quando foi aplicado. syncIndexes dropa o
// índice legado de transaction e aplica o partialFilterExpression atual — necessário
// pra não manter o E11000 { rideId:null, type:"commission" } em bases já deployadas.
// Os updateMany limpam os nulls legados que o índice antigo indexava e que o
// $type:objectId do índice atual ignora. Rodar manualmente antes de tirar do boot.
async function migrate() {
    try {
        const dbUri = process.env.DB_CONNECT;
        if (!dbUri) throw new Error('DB_CONNECT não encontrado no .env');

        console.log('Conectando ao banco de dados...');
        await mongoose.connect(dbUri);

        const transactionModel = require('../models/transaction.model');

        console.log('Sincronizando índices de transaction...');
        const syncResult = await transactionModel.syncIndexes();
        console.log('syncIndexes:', syncResult.length ? syncResult : '(nenhuma alteração necessária)');

        const rideResult = await transactionModel.collection.updateMany(
            { rideId: null },
            { $unset: { rideId: '' } }
        );
        console.log(`rideId nulo removido de ${rideResult.modifiedCount} documento(s).`);

        const parcelResult = await transactionModel.collection.updateMany(
            { parcelId: null },
            { $unset: { parcelId: '' } }
        );
        console.log(`parcelId nulo removido de ${parcelResult.modifiedCount} documento(s).`);

        console.log('Migração concluída. Uma segunda execução não altera registros já corrigidos.');
    } catch (error) {
        console.error('Erro na migração:', error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

migrate();
