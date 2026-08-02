const mongoose = require('mongoose');

// optimisticConcurrency: ver comentário em tariffSetting.model.js (Bloco E, achado C1).
const globalSettingSchema = new mongoose.Schema({
    platformCommission: {
        type: Number,
        required: true,
        default: 20
    },
    minFare: {
        type: Number,
        required: true,
        default: 5.0
    },
    pricePerKm: {
        type: Number,
        required: true,
        default: 2.0
    },
    pricePerMinute: {
        type: Number,
        required: true,
        default: 0.5
    },
    // Novas configurações financeiras
    cardFeePercent: { type: Number, default: 0 },
    cardFeeFixed: { type: Number, default: 0 },
    maximumNegativeBalance: { type: Number, default: -20.0 },
    blockDriverOnNegativeBalance: { type: Boolean, default: true },
    minimumPayout: { type: Number, default: 50.0 },
    payoutDeadlineDays: { type: Number, default: 2 },
    // Bloco H (2026-08-02, §6): 7 campos removidos daqui — eram salvos pelo formulário
    // mas nenhuma lógica em todo o projeto os lia, e nenhum tinha caminho de implementação
    // sem construir uma feature nova (gateway de pagamento real, API de clima, etc.):
    // vehicleTypes (superado pelo vehicleCategory dinâmico), promotionalHours (texto
    // livre sem UI pra exibi-lo), minRecharge/platformPixKey (o fluxo de recarga em si já
    // está desativado propositalmente — ver captain.controller.js: rechargeWallet),
    // minDriverBalance/allowNegativeBalance (redundantes com maximumNegativeBalance +
    // blockDriverOnNegativeBalance, que já funcionam), paymentGateway (nenhuma
    // integração de gateway existe). automaticPayout foi mantido — ver
    // docs/plans/2026-08-02-execucao-bloco-h-admin-regras-negocio.md.
    automaticPayout: { type: Boolean, default: false }
}, { timestamps: true, optimisticConcurrency: true });

module.exports = mongoose.model('globalSetting', globalSettingSchema);
