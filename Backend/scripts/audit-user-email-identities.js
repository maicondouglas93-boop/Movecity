'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { normalizeEmail } = require('../utils/googleIdentity');

function fingerprint(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

async function buildAudit(usersCollection, { session } = {}) {
    const normalizedGroups = new Map();
    const firebaseUidGroups = new Map();
    const normalizationCandidates = [];
    const invalidEmails = [];
    let totalUsers = 0;
    let missingFirebaseUid = 0;

    const cursor = usersCollection.find({}, {
        projection: { _id: 1, email: 1, firebaseUid: 1 },
        ...(session ? { session } : {}),
    });
    for await (const user of cursor) {
        totalUsers += 1;
        const id = String(user._id);
        const normalizedEmail = normalizeEmail(user.email);

        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            invalidEmails.push({ userId: id, emailFingerprint: fingerprint(user.email || '') });
        } else {
            const members = normalizedGroups.get(normalizedEmail) || [];
            members.push(id);
            normalizedGroups.set(normalizedEmail, members);

            if (user.email !== normalizedEmail) {
                normalizationCandidates.push({
                    userId: id,
                    normalizedEmailFingerprint: fingerprint(normalizedEmail),
                });
            }
        }

        if (!user.firebaseUid) {
            missingFirebaseUid += 1;
        } else {
            const uidMembers = firebaseUidGroups.get(user.firebaseUid) || [];
            uidMembers.push(id);
            firebaseUidGroups.set(user.firebaseUid, uidMembers);
        }
    }

    const normalizedEmailCollisions = [...normalizedGroups.entries()]
        .filter(([, userIds]) => userIds.length > 1)
        .map(([normalizedEmail, userIds]) => ({
            normalizedEmailFingerprint: fingerprint(normalizedEmail),
            userIds,
        }));
    const firebaseUidCollisions = [...firebaseUidGroups.entries()]
        .filter(([, userIds]) => userIds.length > 1)
        .map(([firebaseUid, userIds]) => ({
            firebaseUidFingerprint: fingerprint(firebaseUid),
            userIds,
        }));

    return {
        generatedAt: new Date().toISOString(),
        readOnly: true,
        summary: {
            totalUsers,
            missingFirebaseUid,
            normalizationCandidates: normalizationCandidates.length,
            normalizedEmailCollisions: normalizedEmailCollisions.length,
            firebaseUidCollisions: firebaseUidCollisions.length,
            invalidEmails: invalidEmails.length,
        },
        normalizationCandidates,
        normalizedEmailCollisions,
        firebaseUidCollisions,
        invalidEmails,
    };
}

async function main() {
    if (!process.env.DB_CONNECT) throw new Error('DB_CONNECT é obrigatório.');
    await mongoose.connect(process.env.DB_CONNECT);
    try {
        const report = await buildAudit(mongoose.connection.collection('users'));
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (
            report.summary.normalizedEmailCollisions
            || report.summary.firebaseUidCollisions
            || report.summary.invalidEmails
        ) {
            process.exitCode = 2;
        }
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { buildAudit };
