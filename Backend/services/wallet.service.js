const walletModel = require('../models/wallet.model');
const transactionModel = require('../models/transaction.model');
const payoutModel = require('../models/payout.model');
const { deleteByPrefix } = require('../cache/cache');
const captainModel = require('../models/captain.model');
const globalSettingModel = require('../models/globalSetting.model');
const { sendMessageToSocketId } = require('../socket');
const notificationService = require('./notification.service');

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

        // Fase 5 da auditoria de push (2026-08-02): sendRechargeApproved já existia
        // desde sempre mas nunca era chamada — recarga só avisava quem estivesse com o
        // app aberto naquele instante (socket). Só recarga gera push (não toda
        // movimentação de carteira) pra não notificar demais por débito de comissão etc.
        if (type === 'recharge') {
            notificationService.sendRechargeApproved(captainId, { transactionId: transaction._id.toString(), amount }).catch(console.error);
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

// Auditoria do painel administrativo (2026-08-02, Bloco C): nada no backend criava um
// `payout` — o Centro Financeiro do admin administrava uma coleção permanentemente
// vazia porque não existia um jeito do motorista solicitar o saque do que já tinha
// pendente. Solicita o saldo pendente inteiro (não um valor parcial escolhido à mão —
// a UI já descreve esse saldo como "aguardando transferência bancária para você").
const requestPayout = async (captainId) => {
    const captain = await captainModel.findById(captainId);
    if (!captain) throw new Error('Motorista não encontrado');
    if (!captain.pix || !captain.pix.key) {
        throw new Error('Cadastre uma chave Pix antes de solicitar o saque');
    }

    const settings = await globalSettingModel.findOne();
    const minimumPayout = settings?.minimumPayout ?? 50;

    const wallet = await getWallet(captainId);
    if (wallet.pendingBalance < minimumPayout) {
        throw new Error(`Saldo insuficiente para saque. O valor mínimo é R$ ${minimumPayout.toFixed(2)} (seu saldo pendente: R$ ${wallet.pendingBalance.toFixed(2)})`);
    }

    const existingPending = await payoutModel.findOne({
        captainId,
        status: { $in: ['requested', 'in_analysis', 'approved', 'processing'] }
    });
    if (existingPending) {
        throw new Error('Você já tem uma solicitação de saque em andamento');
    }

    const payout = await payoutModel.create({
        captainId,
        amount: wallet.pendingBalance,
        status: 'requested',
        bankDetailsSnapshot: {
            pixKey: captain.pix.key,
            bankName: captain.bankDetails?.bankName,
            bankAgency: captain.bankDetails?.bankAgency,
            bankAccount: captain.bankDetails?.bankAccount,
            accountType: captain.bankDetails?.accountType
        },
        gateway: 'manual'
    });

    return payout;
};

module.exports = { getWallet, createTransaction, getTransactions, requestPayout };
