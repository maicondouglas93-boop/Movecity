const mongoose = require('mongoose');

// Tarifas e regras de encomenda (singleton lógico — um documento ativo).
// As chaves de deliveryPricing são os nomes internos das categorias criadas pelo ADM
// (moto, car, suv, utilitario...). Mixed é intencional; cada bloco é normalizado e
// validado por parcel.service.js antes de ser salvo.
// Campos top-level legados (baseFare, perKm, …) permanecem para migração/leitura antiga.
const parcelSettingSchema = new mongoose.Schema({
    // --- Legado (pré-deliveryPricing); mantidos e sincronizados a partir de moto ---
    baseFare: { type: Number, default: 6 },
    perKm: { type: Number, default: 1.8 },
    perMinute: { type: Number, default: 0.35 },
    minimumFare: { type: Number, default: 8 },
    vehicleSurcharge: {
        moto: { type: Number, default: 0 },
        car: { type: Number, default: 4 },
    },
    requireDeliveryPin: { type: Boolean, default: true },
    motoMaxSize: {
        type: String,
        enum: ['small', 'medium', 'large'],
        default: 'medium',
    },
    motoMaxWeightKg: { type: Number, default: 10 },
    blockIncompatibleMoto: { type: Boolean, default: true },

    // --- Fonte de verdade atual ---
    deliveryPricing: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({
            moto: {},
            car: {
                baseFare: 10,
                perKm: 1.8,
                perMinute: 0.35,
                minimumFare: 12,
                maxWeightKg: 50,
                maxPackageSize: 'large',
                requireDeliveryPin: true,
                blockIncompatibleVehicle: true,
            },
        }),
    },
    // 1 = legado (tarifa global); 2 = regras por categoria migradas ou salvas pelo admin.
    pricingVersion: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model('parcelSetting', parcelSettingSchema);
