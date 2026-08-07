const mongoose = require('mongoose');

/**
 * Tarifas aplicadas a TODAS as categorias de veículo quando active=true.
 * Independentes de VehicleCategory.pricing (base/km/minuto/adicionais).
 */
const globalTariffSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
    },
    value: {
        type: Number,
        required: true,
        min: 0,
    },
    active: {
        type: Boolean,
        default: true,
        index: true,
    },
}, { timestamps: true });

module.exports = mongoose.model('globalTariff', globalTariffSchema);
