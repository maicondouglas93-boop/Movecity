const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });
mongoose.set('autoIndex', false);

const rideModel = require('../models/ride.model');
const paymentModel = require('../models/payment.model');
const promotionUsageModel = require('../models/promotionUsage.model');
const userWalletTransactionModel = require('../models/userWalletTransaction.model');
const { PASSENGER_ACTIVE_RIDE_STATUSES } = require('../config/rideCreationPolicy');

const duplicateGroups = (match, groupId) => [
    { $match: match },
    { $group: { _id: groupId, count: { $sum: 1 }, documents: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 },
];

async function audit() {
    const dbUri = process.env.DB_CONNECT;
    if (!dbUri) throw new Error('DB_CONNECT não encontrado no .env');
    await mongoose.connect(dbUri, { autoIndex: false });

    const checks = {
        activePassengerRides: await rideModel.aggregate(duplicateGroups(
            { user: { $type: 'objectId' }, status: { $in: PASSENGER_ACTIVE_RIDE_STATUSES } },
            '$user'
        )),
        passengerIdempotencyKeys: await rideModel.aggregate(duplicateGroups(
            {
                user: { $type: 'objectId' },
                source: 'passenger_requested',
                idempotencyKey: { $type: 'string' },
            },
            { user: '$user', idempotencyKey: '$idempotencyKey' }
        )),
        ridePayments: await paymentModel.aggregate(duplicateGroups(
            { rideId: { $type: 'objectId' } },
            '$rideId'
        )),
        promotionUsages: await promotionUsageModel.aggregate(duplicateGroups(
            { rideId: { $type: 'objectId' } },
            '$rideId'
        )),
        walletRideEffects: await userWalletTransactionModel.aggregate(duplicateGroups(
            { rideId: { $type: 'objectId' } },
            { rideId: '$rideId', type: '$type' }
        )),
    };

    const summary = Object.fromEntries(
        Object.entries(checks).map(([name, groups]) => [name, {
            duplicateGroups: groups.length,
            samples: groups,
        }])
    );
    console.log(JSON.stringify(summary, null, 2));

    if (Object.values(checks).some((groups) => groups.length > 0)) {
        console.error('Auditoria reprovada: saneie os grupos duplicados antes de publicar os índices únicos.');
        process.exitCode = 2;
    } else {
        console.log('Auditoria aprovada: nenhum conflito encontrado para os novos índices.');
    }
}

audit()
    .catch((err) => {
        console.error('Falha ao auditar índices de criação de corrida:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
