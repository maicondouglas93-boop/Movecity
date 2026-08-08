// Leitura direta do estado financeiro real gravado pelo wallet.service/transaction.model
// durante o fluxo — usado pra comparar antes/depois nos relatórios dos cenários.
const walletModel = require('../../../models/wallet.model');
const transactionModel = require('../../../models/transaction.model');

async function readWalletSnapshot(captainId) {
    const wallet = await walletModel.findOne({ captainId });
    return {
        creditBalance: wallet?.creditBalance ?? 0,
        pendingBalance: wallet?.pendingBalance ?? 0,
    };
}

async function readTransactions({ captainId, rideId, parcelId }) {
    const filter = { captainId };
    if (rideId) filter.rideId = rideId;
    if (parcelId) filter.parcelId = parcelId;
    return transactionModel.find(filter).sort({ createdAt: 1 }).lean();
}

module.exports = { readWalletSnapshot, readTransactions };
