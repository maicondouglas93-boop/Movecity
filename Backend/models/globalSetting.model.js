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
    }
}, { timestamps: true });

module.exports = mongoose.model('globalSetting', globalSettingSchema);
