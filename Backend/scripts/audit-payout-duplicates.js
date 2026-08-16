const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });
mongoose.set('autoIndex', false);

const walletModel = require('../models/wallet.model');
const payoutModel = require('../models/payout.model');

const ACTIVE_PAYOUT_STATUSES = ['requested', 'in_analysis', 'approved', 'processing'];

async function audit() {
    const dbUri = process.env.DB_CONNECT;
    if (!dbUri) throw new Error('DB_CONNECT não encontrado no .env');
    await mongoose.connect(dbUri, { autoIndex: false });

    const wallets = await walletModel.aggregate([
        { $match: { pendingBalance: { $gt: 0 } } },
        { $project: { captainId: 1, pendingBalance: 1 } },
        { $sort: { pendingBalance: -1 } },
    ]);

    const walletTotals = await walletModel.aggregate([
        { $group: { _id: null, totalPending: { $sum: '$pendingBalance' }, count: { $sum: 1 } } },
    ]);

    const payoutsByStatus = await payoutModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
    ]);

    const duplicateActivePayouts = await payoutModel.aggregate([
        { $match: { status: { $in: ACTIVE_PAYOUT_STATUSES } } },
        {
            $group: {
                _id: '$captainId',
                count: { $sum: 1 },
                payoutIds: { $push: '$_id' },
                statuses: { $push: '$status' },
                amounts: { $push: '$amount' },
            },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
    ]);

    const summary = {
        wallets_with_pending_balance: {
            count: wallets.length,
            totalPendingAcrossAllWallets: walletTotals[0]?.totalPending || 0,
            totalWallets: walletTotals[0]?.count || 0,
            samples: wallets.slice(0, 20),
        },
        payouts_by_status: payoutsByStatus,
        duplicate_active_payouts_per_captain: {
            count: duplicateActivePayouts.length,
            details: duplicateActivePayouts,
        },
    };

    console.log(JSON.stringify(summary, null, 2));

    if (duplicateActivePayouts.length > 0) {
        console.error('ATENÇÃO: existem motoristas com mais de um payout ativo simultâneo — a duplicidade já aconteceu.');
        process.exitCode = 2;
    } else {
        console.log('Nenhum payout ativo duplicado encontrado hoje.');
    }
}

audit()
    .catch((err) => {
        console.error('Falha ao auditar payouts:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
