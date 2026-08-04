const mongoose = require('mongoose');

// Tarifas e regras de encomenda (singleton lógico — um documento ativo).
const parcelSettingSchema = new mongoose.Schema({
    baseFare: { type: Number, default: 6 },
    perKm: { type: Number, default: 1.8 },
    perMinute: { type: Number, default: 0.35 },
    minimumFare: { type: Number, default: 8 },
    vehicleSurcharge: {
        moto: { type: Number, default: 0 },
        car: { type: Number, default: 4 },
    },
    requireDeliveryPin: { type: Boolean, default: true },
    // Validação inteligente: moto + tamanho/peso acima disso gera warning (e pode bloquear).
    motoMaxSize: {
        type: String,
        enum: ['small', 'medium', 'large'],
        default: 'medium',
    },
    motoMaxWeightKg: { type: Number, default: 10 },
    blockIncompatibleMoto: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('parcelSetting', parcelSettingSchema);
