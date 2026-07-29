const walletModel = require('../models/wallet.model');
const transactionModel = require('../models/transaction.model');
const { deleteByPrefix } = require('../cache/cache');
const captainModel = require('../models/captain.model');
const globalSettingModel = require('../models/globalSetting.model');
const { sendMessageToSocketId } = require('../socket');

const getWallet = async (captainId) => {
    let wallet = await walletModel.findOne({ captainId });
    if (!wallet) {
        wallet = await walletModel.create({ captainId });
    }
    return wallet;
};

const createTransaction = async ({ captainId, rideId, type, paymentMethod, amount, description, adminId, reason }) => {
    const wallet = await getWallet(captainId);
    let balanceBefore = wallet.creditBalance; // Base para o ledger principal
    
    // Atualiza os saldos com base no tipo
    if (type === 'recharge' || type === 'bonus') {
        wallet.creditBalance += amount;
    } else if (type === 'commission') {
        balanceBefore = wallet.creditBalance;
        wallet.creditBalance -= amount;
        wallet.totalCommissionPaid += amount;
    } else if (type === 'ride_payment') {
        // Se for cartão, o valor vai para pendente (a plataforma deve repassar)
        // Se for dinheiro/pix, o valor já está com o motorista
        if (paymentMethod === 'card') {
            balanceBefore = wallet.pendingBalance; // Para cartão, o ledger reflete o pending
            wallet.pendingBalance += amount;
        }
        wallet.totalEarned += amount;
    } else if (type === 'payout' || type === 'withdraw') {
        balanceBefore = wallet.pendingBalance;
        wallet.pendingBalance -= amount;
    } else if (type === 'adjustment') {
        // Ajustes manuais geralmente afetam o creditBalance, a menos que especificado de outra forma.
        // Assumindo creditBalance aqui por padrão.
        wallet.creditBalance += amount;
    }

    let balanceAfter = (type === 'ride_payment' && paymentMethod === 'card') || type === 'payout' || type === 'withdraw' 
        ? wallet.pendingBalance 
        : wallet.creditBalance;

    const transaction = await transactionModel.create({
        captainId,
        rideId,
        type,
        paymentMethod,
        amount,
        balanceBefore,
        balanceAfter,
        description,
        adminId,
        reason,
        status: 'completed'
    });

    await wallet.save();

    // Regra de bloqueio de motorista
    const settings = await globalSettingModel.findOne() || { blockDriverOnNegativeBalance: true, maximumNegativeBalance: 0 };
    if (settings.blockDriverOnNegativeBalance && wallet.creditBalance < settings.maximumNegativeBalance) {
        await captainModel.findByIdAndUpdate(captainId, { canReceiveRides: false });
    } else {
        // Desbloqueia se estiver acima
        await captainModel.findByIdAndUpdate(captainId, { canReceiveRides: true });
    }

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
