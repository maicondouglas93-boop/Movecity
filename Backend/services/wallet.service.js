const walletModel = require('../models/wallet.model');
const transactionModel = require('../models/transaction.model');
const { deleteByPrefix } = require('../cache/cache');
const captainModel = require('../models/captain.model');
const { sendMessageToSocketId } = require('../socket');

const getWallet = async (captainId) => {
    let wallet = await walletModel.findOne({ captainId });
    if (!wallet) {
        wallet = await walletModel.create({ captainId });
    }
    return wallet;
};

const createTransaction = async ({ captainId, rideId, type, paymentMethod, amount, description }) => {
    const wallet = await getWallet(captainId);
    const balanceBefore = wallet.balance;
    let balanceAfter = balanceBefore;

    // Credits add to wallet, debits subtract
    const isCredit = ['recharge', 'bonus'].includes(type);
    const isDebit = ['commission', 'withdraw'].includes(type);

    if (isCredit) {
        balanceAfter = balanceBefore + amount;
    } else if (isDebit) {
        balanceAfter = balanceBefore - amount;
    }

    const transaction = await transactionModel.create({
        captainId,
        rideId,
        type,
        paymentMethod,
        amount,
        balanceBefore,
        balanceAfter,
        description,
        status: 'completed'
    });

    wallet.balance = balanceAfter;
    await wallet.save();

    deleteByPrefix(`wallet:${captainId}`);
    deleteByPrefix(`transactions:${captainId}`);
    deleteByPrefix(`profile:captain:${captainId}`);
    deleteByPrefix(`summary:${captainId}`);

    const captain = await captainModel.findById(captainId);
    if (captain && captain.socketId) {
        sendMessageToSocketId(captain.socketId, {
            event: 'wallet-updated',
            data: { wallet, transaction }
        });
        sendMessageToSocketId(captain.socketId, {
            event: 'summary-updated',
            data: { timestamp: Date.now() }
        });
    }

    return { transaction, wallet };
};

const getTransactions = async (captainId, limit = 50) => {
    return await transactionModel.find({ captainId })
        .sort({ createdAt: -1 })
        .limit(limit);
};

module.exports = { getWallet, createTransaction, getTransactions };
