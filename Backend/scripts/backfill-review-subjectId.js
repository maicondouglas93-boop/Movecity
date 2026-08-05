/**
 * Fase 4 do plano de correção de encomendas (2026-08-04).
 * Rodar ANTES do deploy que cria o índice único {subjectType, subjectId, type}.
 *
 * Uso (com MONGO_URI no ambiente / .env do Backend):
 *   node scripts/backfill-review-subjectId.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    const uri = process.env.DB_CONNECT || process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('Defina DB_CONNECT / MONGO_URI');
        process.exit(1);
    }

    await mongoose.connect(uri);
    const reviews = mongoose.connection.collection('reviews');

    const before = await reviews.countDocuments({
        subjectId: { $exists: false },
        ride: { $exists: true },
    });
    console.log(`Reviews legado sem subjectId: ${before}`);

    const result = await reviews.updateMany(
        { subjectId: { $exists: false }, ride: { $exists: true } },
        [{ $set: { subjectId: '$ride', subjectType: 'ride' } }]
    );

    console.log(`matched=${result.matchedCount} modified=${result.modifiedCount}`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
