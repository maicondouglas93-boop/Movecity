const walletModel = require('../models/wallet.model');
const transactionModel = require('../models/transaction.model');
const payoutModel = require('../models/payout.model');
const { deleteByPrefix } = require('../cache/cache');
const captainModel = require('../models/captain.model');
const { getCachedGlobalSetting } = require('./globalSettingCache.service');
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
        case 'parcel_payment':
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
const createTransaction = async ({ captainId, rideId, parcelId, type, paymentMethod, amount, description, adminId, reason, session }) => {
    const incFields = buildIncFields(type, paymentMethod, amount);
    const ledgerField = resolveLedgerField(type, paymentMethod);

    const wallet = await walletModel.findOneAndUpdate(
        { captainId },
        { $inc: incFields },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );

    const balanceAfter = wallet[ledgerField];
    const balanceBefore = balanceAfter - (incFields[ledgerField] || 0);

    // Nunca gravar rideId/parcelId como null: o índice único parcial indexaria null
    // e a próxima comissão sem vínculo (encomenda, ajuste, etc.) colidiria com E11000.
    const payload = {
        captainId,
        type,
        paymentMethod,
        amount,
        balanceBefore,
        balanceAfter,
        description,
        adminId,
        reason,
        status: 'completed'
    };
    if (rideId) payload.rideId = rideId;
    if (parcelId) payload.parcelId = parcelId;

    const [transaction] = await transactionModel.create([payload], { session });

    // Regra de bloqueio de motorista — parte da mesma unidade atômica da movimentação
    // que a disparou (saldo negativo pode ser resultado direto desta transação).
    // Auditoria de cache (2026-08-08, A5): singleton cacheado (TTL curto, 120s,
    // justamente por gatear essa regra financeira) em vez de findOne().session() —
    // não há escrita concorrente em GlobalSetting dentro desta transação, então não
    // há risco de leitura inconsistente por sair da session; o único efeito é
    // aceitar até 120s de atraso numa mudança de regra feita pelo admin, aceito de
    // propósito no plano de cache.
    const settings = await getCachedGlobalSetting()
        || { blockDriverOnNegativeBalance: true, maximumNegativeBalance: 0 };
    const shouldBlock = settings.blockDriverOnNegativeBalance && wallet.creditBalance < settings.maximumNegativeBalance;
    await captainModel.findByIdAndUpdate(captainId, { canReceiveRides: !shouldBlock }, { session });

    const applySideEffects = async () => {
        // Auditoria de cache (2026-08-08): wallet:/transactions: não existem mais —
        // GET /captains/wallet e /captains/transactions pararam de cachear (decisão
        // explícita: financeiro sempre fonte única de verdade). profile:captain/summary
        // continuam cacheados por outros motivos, então essas duas invalidações ficam.
        deleteByPrefix(`profile:captain:${captainId}`);
        deleteByPrefix(`summary:${captainId}`);

        const captain = await captainModel.findById(captainId);
        if (captain && captain.socketId) {
            const { sanitizeCaptainWallet, sanitizeCaptainTransactions } = require('../utils/financePrivacy');
            const safeWallet = sanitizeCaptainWallet(wallet);

            // Cash/pix: pagamento e comissão são emitidos em sockets separados.
            // Para o crédito do serviço, busca a comissão no ride/parcel e normaliza o amount.
            const hints = { commissionByRide: {}, commissionByParcel: {} };
            const rawTx = transaction.toObject ? transaction.toObject() : transaction;
            if (
                (rawTx.type === 'ride_payment' || rawTx.type === 'parcel_payment') &&
                rawTx.paymentMethod !== 'card'
            ) {
                if (rawTx.rideId) {
                    const rideModel = require('../models/ride.model');
                    const ride = await rideModel.findById(rawTx.rideId).select('commissionAmount').lean();
                    if (ride?.commissionAmount != null) {
                        hints.commissionByRide[String(rawTx.rideId)] = Number(ride.commissionAmount) || 0;
                    }
                }
                if (rawTx.parcelId) {
                    const parcelModel = require('../models/parcel.model');
                    const parcel = await parcelModel.findById(rawTx.parcelId).select('commissionAmount').lean();
                    if (parcel?.commissionAmount != null) {
                        hints.commissionByParcel[String(rawTx.parcelId)] = Number(parcel.commissionAmount) || 0;
                    }
                }
            }

            const sanitizedList = sanitizeCaptainTransactions([transaction], hints);
            const safeTx = sanitizedList[0] || null;
            // Lançamentos type=commission não são enviados ao app do motorista.
            if (rawTx.type === 'commission') {
                sendMessageToSocketId(captain.socketId, {
                    event: 'wallet-updated',
                    data: { wallet: safeWallet, transaction: null }
                });
            } else {
                sendMessageToSocketId(captain.socketId, {
                    event: 'wallet-updated',
                    data: { wallet: safeWallet, transaction: safeTx }
                });
            }
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

    // Auditoria de cache (2026-08-08, A5): mesmo singleton cacheado usado em createTransaction.
    const settings = await getCachedGlobalSetting();
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
