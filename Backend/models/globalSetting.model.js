const mongoose = require('mongoose');

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
    cancellationFee: {
        type: Number,
        required: true,
        default: 4.0
    },
    vehicleTypes: {
        type: [String],
        default: ['car', 'moto', 'auto']
    },
    promotionalHours: {
        type: String,
        default: 'Nenhum horário promocional ativo'
    },
    // Novas configurações financeiras
    cardFeePercent: { type: Number, default: 0 },
    cardFeeFixed: { type: Number, default: 0 },
    minRecharge: { type: Number, default: 20.0 },
    minDriverBalance: { type: Number, default: 0.0 },
    allowNegativeBalance: { type: Boolean, default: false },
    maximumNegativeBalance: { type: Number, default: -20.0 },
    blockDriverOnNegativeBalance: { type: Boolean, default: true },
    minimumPayout: { type: Number, default: 50.0 },
    payoutDeadlineDays: { type: Number, default: 2 },
    automaticPayout: { type: Boolean, default: false },
    paymentGateway: { type: String, enum: ['asaas', 'stripe', 'mercado_pago'], default: 'asaas' },
    platformPixKey: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('globalSetting', globalSettingSchema);
