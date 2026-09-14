const mongoose = require('mongoose');
const globalSettingModel = require('../models/globalSetting.model');
const walletModel = require('../models/wallet.model');
const captainModel = require('../models/captain.model');
const { isDriverCreditBlocked } = require('../utils/driverCreditPolicy');
const { invalidateGlobalSettingCache } = require('./globalSettingCache.service');
const { deleteByPrefix } = require('../cache/cache');

function publicSetting(settings) {
    return { blockDriverOnNegativeBalance: settings?.blockDriverOnNegativeBalance !== false, version: settings?.__v ?? 0 };
}

async function getDriverCreditSetting() {
    return publicSetting(await globalSettingModel.findOne());
}

async function assertDriverCreditAllowed(captainId) {
    // Leituras atuais: a decisão não depende de um canReceiveRides antigo nem do
    // cache de configuração, inclusive após ligar/desligar a regra no painel.
    const [settings, wallet] = await Promise.all([
        globalSettingModel.findOne(),
        walletModel.findOne({ captainId }),
    ]);
    if (isDriverCreditBlocked(wallet?.creditBalance ?? 0, settings)) {
        const error = new Error('Crédito negativo. Recarregue sua carteira para iniciar novos serviços.');
        error.code = 'DRIVER_CREDIT_BLOCKED';
        error.statusCode = 403;
        throw error;
    }
}

async function updateDriverCreditSetting({ blockDriverOnNegativeBalance, version }) {
    if (typeof blockDriverOnNegativeBalance !== 'boolean' || !Number.isInteger(version) || version < 0) {
        const error = new Error('Informe a regra de bloqueio e uma versão válida.');
        error.statusCode = 400;
        throw error;
    }
    const session = await mongoose.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            let settings = await globalSettingModel.findOne().session(session);
            if ((settings?.__v ?? 0) !== version) {
                const error = new Error('A regra foi alterada por outro administrador. Recarregue antes de salvar.');
                error.statusCode = 409;
                throw error;
            }
            if (!settings) settings = new globalSettingModel();
            settings.blockDriverOnNegativeBalance = blockDriverOnNegativeBalance;
            settings.maximumNegativeBalance = 0;
            await settings.save({ session });

            // Atualiza o indicador usado pelo despacho no mesmo commit da regra.
            // Aprovação e bloqueios administrativos permanecem independentes.
            const negativeIds = blockDriverOnNegativeBalance
                ? await walletModel.distinct('captainId', { creditBalance: { $lt: 0 } }).session(session)
                : [];
            const eligible = { approvalStatus: 'aprovado', isBlocked: { $ne: true } };
            await captainModel.updateMany({ ...eligible, _id: { $nin: negativeIds } }, { $set: { canReceiveRides: true } }, { session });
            if (negativeIds.length) {
                await captainModel.updateMany({ ...eligible, _id: { $in: negativeIds } }, { $set: { canReceiveRides: false } }, { session });
            }
            result = publicSetting(settings);
        });
    } finally {
        await session.endSession();
    }
    invalidateGlobalSettingCache();
    deleteByPrefix('profile:captain:');
    deleteByPrefix('summary:');
    deleteByPrefix('drivers:');
    return result;
}

module.exports = { getDriverCreditSetting, updateDriverCreditSetting, assertDriverCreditAllowed };
