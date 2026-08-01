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

// Qual campo do wallet representa o "saldo" movimentado por cada tipo de transação —
// usado tanto pra montar o $inc quanto pra saber de qual campo tirar balanceBefore/After.
function resolveLedgerField(type, paymentMethod) {
    if ((type === 'ride_payment' && paymentMethod === 'card') || type === 'payout' || type === 'withdraw') {
        return 'pendingBalance';
    }
    return 'creditBalance';
}

function buildIncFields(type, paymentMethod, amount) {
    const inc = {};
    switch (type) {
        case 'recharge':
        case 'bonus':
        case 'adjustment':
            inc.creditBalance = amount;
            break;
        case 'commission':
            inc.creditBalance = -amount;
            inc.totalCommissionPaid = amount;
            break;
        case 'ride_payment':
            inc.totalEarned = amount;
            if (paymentMethod === 'card') {
                inc.pendingBalance = amount;
            }
            break;
        case 'payout':
        case 'withdraw':
            inc.pendingBalance = -amount;
            break;
        default:
            throw new Error(`Unknown transaction type: ${type}`);
    }
    return inc;
}

// Registra uma movimentação financeira e atualiza o wallet do motorista de forma
// atômica ($inc via findOneAndUpdate, nunca read-modify-write com wallet.save()).
//
// `session` é opcional: quando o chamador está dentro de uma transação Mongo maior
// (ex.: confirmPaymentReceived em ride.service.js), passa a própria session e assume
// a responsabilidade de chamar `applySideEffects()` só DEPOIS do commit — emitir socket
// ou invalidar cache antes do commit avisaria o motorista de um dinheiro que pode nunca
// ter sido efetivado, se a transação abortar. Sem `session` (uso direto, como em
// admin.service.js e webhook.controller.js), o comportamento é o de sempre: os efeitos
// colaterais acontecem imediatamente, antes de retornar.
const createTransaction = async ({ captainId, rideId, type, paymentMethod, amount, description, adminId, reason, session }) => {
    const incFields = buildIncFields(type, paymentMethod, amount);
    const ledgerField = resolveLedgerField(type, paymentMethod);

    const wallet = await walletModel.findOneAndUpdate(
        { captainId },
        { $inc: incFields },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );

    const balanceAfter = wallet[ledgerField];
    const balanceBefore = balanceAfter - (incFields[ledgerField] || 0);

    const [transaction] = await transactionModel.create([{
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
    }], { session });

    // Regra de bloqueio de motorista — parte da mesma unidade atômica da movimentação
    // que a disparou (saldo negativo pode ser resultado direto desta transação).
    const settings = await globalSettingModel.findOne().session(session || null)
        || { blockDriverOnNegativeBalance: true, maximumNegativeBalance: 0 };
    const shouldBlock = settings.blockDriverOnNegativeBalance && wallet.creditBalance < settings.maximumNegativeBalance;
    await captainModel.findByIdAndUpdate(captainId, { canReceiveRides: !shouldBlock }, { session });

    const applySideEffects = async () => {
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
    };

    if (!session) {
        await applySideEffects();
    }

    return { transaction, wallet, applySideEffects };
};

const getTransactions = async (captainId, limit = 50) => {
    return await transactionModel.find({ captainId })
        .sort({ createdAt: -1 })
        .limit(limit);
};

module.exports = { getWallet, createTransaction, getTransactions };
