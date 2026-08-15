'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { normalizeEmail } = require('../utils/googleIdentity');
const { buildAudit } = require('./audit-user-email-identities');

function migrationError(message) {
    const error = new Error(message);
    error.code = 'EMAIL_NORMALIZATION_CONFLICT';
    return error;
}

function assertEmailNormalizationMigrationSafe(report) {
    if (report.summary.normalizedEmailCollisions > 0) {
        throw migrationError('Migração recusada: existem colisões de e-mail normalizado.');
    }
    if (report.summary.firebaseUidCollisions > 0) {
        throw migrationError('Migração recusada: existem colisões de Firebase UID.');
    }
    if (report.summary.invalidEmails > 0) {
        throw migrationError('Migração recusada: existem e-mails ausentes ou inválidos.');
    }
}

async function applyNormalization(collection, session) {
    const operations = [];
    const cursor = collection.find({}, { projection: { _id: 1, email: 1 }, session });
    for await (const user of cursor) {
        const normalizedEmail = normalizeEmail(user.email);
        if (normalizedEmail && normalizedEmail !== user.email) {
            operations.push({
                updateOne: {
                    filter: { _id: user._id, email: user.email },
                    update: { $set: { email: normalizedEmail } },
                }
            });
        }
    }

    if (!operations.length) return 0;
    const result = await collection.bulkWrite(operations, { ordered: true, session });
    if (result.modifiedCount !== operations.length) {
        throw migrationError('Migração abortada: os dados mudaram durante a normalização.');
    }
    return result.modifiedCount;
}

async function main() {
    if (!process.env.DB_CONNECT) throw new Error('DB_CONNECT é obrigatório.');
    const apply = process.argv.includes('--apply');
    await mongoose.connect(process.env.DB_CONNECT);

    try {
        const collection = mongoose.connection.collection('users');
        const preview = await buildAudit(collection);
        process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
        assertEmailNormalizationMigrationSafe(preview);

        if (!apply) {
            process.stdout.write('DRY-RUN: nenhuma alteração realizada. Use --apply somente após backup e revisão.\n');
            return;
        }

        const session = await mongoose.startSession();
        let modifiedCount = 0;
        try {
            await session.withTransaction(async () => {
                const transactionAudit = await buildAudit(collection, { session });
                assertEmailNormalizationMigrationSafe(transactionAudit);
                modifiedCount = await applyNormalization(collection, session);
            }, {
                readConcern: { level: 'snapshot' },
                writeConcern: { w: 'majority' },
            });
        } finally {
            await session.endSession();
        }

        process.stdout.write(`Migração concluída em transação: ${modifiedCount} usuário(s) normalizado(s).\n`);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`${error.code || 'ERROR'}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    assertEmailNormalizationMigrationSafe,
    applyNormalization,
};
