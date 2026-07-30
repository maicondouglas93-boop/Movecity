const mongoose = require('mongoose');

const vehicleCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        description: "Identificador interno (ex: car, moto, auto, suv)"
    },
    displayName: {
        type: String,
        required: true,
        description: "Nome de Exibição (ex: Carro Econômico)"
    },
    baseFare: {
        type: Number,
        required: true,
        default: 5.0,
        description: "Tarifa inicial ao entrar no veículo"
    },
    perKmRate: {
        type: Number,
        required: true,
        default: 1.5,
        description: "Valor cobrado por Quilômetro"
    },
    perMinuteRate: {
        type: Number,
        required: true,
        default: 0.3,
        description: "Valor cobrado por Minuto"
    },
    minFare: {
        type: Number,
        required: true,
        default: 8.0,
        description: "Valor mínimo da corrida nesta categoria"
    },
    maxFare: {
        type: Number,
        description: "Valor máximo opcional da corrida nesta categoria"
    },
    isActive: {
        type: Boolean,
        default: true
    },
    dynamicMultiplier: {
        type: Number,
        default: 1.0,
        description: "Multiplicador dinâmico de tarifa para esta categoria (ex: chuva, alta demanda)"
    },
    rainFeeMultiplier: {
        type: Number,
        default: 1.0,
        description: "Multiplicador específico de chuva para esta categoria"
    }
}, { timestamps: true });

module.exports = mongoose.model('vehicleCategory', vehicleCategorySchema);
