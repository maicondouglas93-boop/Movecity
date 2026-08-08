/**
 * Hard-delete de motoristas + dados relacionados (Mongo).
 *
 * Uso:
 *   node scripts/delete-captains-cascade.js           # dry-run
 *   node scripts/delete-captains-cascade.js --execute  # apaga de verdade
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const captainModel = require('../models/captain.model');
const rideModel = require('../models/ride.model');
const parcelModel = require('../models/parcel.model');
const walletModel = require('../models/wallet.model');
const transactionModel = require('../models/transaction.model');
const payoutModel = require('../models/payout.model');
const rechargeModel = require('../models/recharge.model');
const reviewModel = require('../models/review.model');
const chatModel = require('../models/chat.model');
const messageModel = require('../models/message.model');
const notificationModel = require('../models/notification.model');
const notificationTokenModel = require('../models/notificationToken.model');
const refreshTokenModel = require('../models/refreshToken.model');
const adminLogModel = require('../models/adminLog.model');
const paymentModel = require('../models/payment.model');
const promotionUsageModel = require('../models/promotionUsage.model');
const supportTicketModel = require('../models/supportTicket.model');

const EMAIL_MATCHERS = [
    'maicondouglas93@gmail.com',
    /^capit[aã]o@teste\.com$/i,
    /^capit[aã]o@exemplo\.com$/i,
    /^capit[aã]o-auto@exemplo\.com$/i,
    // variantes ASCII de seed
    'captain@test.com',
    'captain@example.com',
    'captain-auto@example.com',
];

const PLATES = [
    'UAS0G18',
    'MH-12-CAR-1111',
    'MH-12-CAR-2222',
    'MH-12-AUTO-3333',
];

async function findTargetCaptains() {
    const emailOr = EMAIL_MATCHERS.map((e) => (
        typeof e === 'string' ? { email: e.toLowerCase() } : { email: e }
    ));
    const plateOr = PLATES.map((p) => ({ 'vehicle.plate': new RegExp(`^${p.replace(/-/g, '[-]?')}$`, 'i') }));

    return captainModel.find({
        $or: [...emailOr, ...plateOr],
    }).lean();
}

async function countRelated(ids) {
    const idStrs = ids.map((id) => String(id));
    const rides = await rideModel.find({ captain: { $in: ids } }).select('_id').lean();
    const rideIds = rides.map((r) => r._id);

    return {
        captains: ids.length,
        refreshTokens: await refreshTokenModel.countDocuments({ userId: { $in: ids }, userType: 'captain' }),
        notificationTokens: await notificationTokenModel.countDocuments({ captainId: { $in: ids } }),
        notifications: await notificationModel.countDocuments({ captainId: { $in: ids } }),
        chats: await chatModel.countDocuments({ captainId: { $in: ids } }),
        reviews: await reviewModel.countDocuments({ captain: { $in: ids } }),
        transactions: await transactionModel.countDocuments({ captainId: { $in: ids } }),
        payouts: await payoutModel.countDocuments({ captainId: { $in: ids } }),
        recharges: await rechargeModel.countDocuments({ captainId: { $in: ids } }),
        wallets: await walletModel.countDocuments({ captainId: { $in: ids } }),
        rides: rides.length,
        parcels: await parcelModel.countDocuments({ captain: { $in: ids } }),
        payments: rideIds.length
            ? await paymentModel.countDocuments({ rideId: { $in: rideIds } })
            : 0,
        promotionUsages: rideIds.length
            ? await promotionUsageModel.countDocuments({ rideId: { $in: rideIds } })
            : 0,
        supportTickets: rideIds.length
            ? await supportTicketModel.countDocuments({ rideId: { $in: rideIds } })
            : 0,
        adminLogs: await adminLogModel.countDocuments({
            targetId: { $in: idStrs },
            targetModel: 'Captain',
        }),
        rideIds,
    };
}

async function hardDelete(ids, rideIds) {
    const idStrs = ids.map((id) => String(id));
    const chats = await chatModel.find({ captainId: { $in: ids } }).select('_id').lean();
    const chatIds = chats.map((c) => c._id);

    const summary = {};

    summary.refreshTokens = (await refreshTokenModel.deleteMany({ userId: { $in: ids }, userType: 'captain' })).deletedCount;
    summary.notificationTokens = (await notificationTokenModel.deleteMany({ captainId: { $in: ids } })).deletedCount;
    summary.notifications = (await notificationModel.deleteMany({ captainId: { $in: ids } })).deletedCount;

    if (chatIds.length) {
        summary.messages = (await messageModel.deleteMany({ chatId: { $in: chatIds } })).deletedCount;
    } else {
        summary.messages = 0;
    }
    summary.messagesByActor = (await messageModel.deleteMany({
        $or: [
            { senderId: { $in: ids }, senderType: 'captain' },
            { recipientId: { $in: ids }, recipientType: 'captain' },
        ],
    })).deletedCount;

    summary.chats = (await chatModel.deleteMany({ captainId: { $in: ids } })).deletedCount;
    summary.reviews = (await reviewModel.deleteMany({ captain: { $in: ids } })).deletedCount;

    summary.transactions = (await transactionModel.deleteMany({ captainId: { $in: ids } })).deletedCount;
    summary.payouts = (await payoutModel.deleteMany({ captainId: { $in: ids } })).deletedCount;
    summary.recharges = (await rechargeModel.deleteMany({ captainId: { $in: ids } })).deletedCount;
    summary.wallets = (await walletModel.deleteMany({ captainId: { $in: ids } })).deletedCount;

    if (rideIds.length) {
        summary.payments = (await paymentModel.deleteMany({ rideId: { $in: rideIds } })).deletedCount;
        summary.promotionUsages = (await promotionUsageModel.deleteMany({ rideId: { $in: rideIds } })).deletedCount;
        summary.supportTickets = (await supportTicketModel.deleteMany({ rideId: { $in: rideIds } })).deletedCount;
    }

    summary.rides = (await rideModel.deleteMany({ captain: { $in: ids } })).deletedCount;
    summary.captainCancellationsPull = (await rideModel.updateMany(
        { 'captainCancellations.captain': { $in: ids } },
        { $pull: { captainCancellations: { captain: { $in: ids } } } }
    )).modifiedCount;

    summary.parcels = (await parcelModel.deleteMany({ captain: { $in: ids } })).deletedCount;
    summary.adminLogs = (await adminLogModel.deleteMany({
        targetId: { $in: idStrs },
        targetModel: 'Captain',
    })).deletedCount;

    summary.captains = (await captainModel.deleteMany({ _id: { $in: ids } })).deletedCount;

    return summary;
}

async function main() {
    const execute = process.argv.includes('--execute');
    const dbUri = process.env.DB_CONNECT;
    if (!dbUri) throw new Error('DB_CONNECT não encontrado no .env');

    await mongoose.connect(dbUri);
    console.log(execute ? 'MODO: EXECUTE (apagando)' : 'MODO: DRY-RUN (nada será apagado)');

    const captains = await findTargetCaptains();
    if (!captains.length) {
        console.log('Nenhum motorista encontrado com os emails/placas alvo.');
        await mongoose.disconnect();
        return;
    }

    console.log('\nMotoristas encontrados:');
    for (const c of captains) {
        console.log(` - ${c.fullname?.firstname || ''} ${c.fullname?.lastname || ''} | ${c.email} | placa=${c.vehicle?.plate || '-'} | id=${c._id}`);
    }

    const ids = captains.map((c) => c._id);
    const related = await countRelated(ids);
    console.log('\nDocumentos relacionados:');
    console.log(JSON.stringify({ ...related, rideIds: related.rideIds.map(String) }, null, 2));

    if (!execute) {
        console.log('\nPara apagar de verdade, rode:');
        console.log('  node scripts/delete-captains-cascade.js --execute');
        await mongoose.disconnect();
        return;
    }

    const summary = await hardDelete(ids, related.rideIds);
    console.log('\nExclusão concluída:');
    console.log(JSON.stringify(summary, null, 2));

    const remaining = await findTargetCaptains();
    console.log(`\nRestantes com mesmo filtro: ${remaining.length}`);

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error(err);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});
