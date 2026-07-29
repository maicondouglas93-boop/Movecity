const mongoose = require('mongoose');

const tariffSettingSchema = new mongoose.Schema({
    minDistanceIncluded: {
        type: Number,
        default: 0,
        description: "Distância mínima (em metros) já inclusa na tarifa base"
    },
    minTimeIncluded: {
        type: Number,
        default: 0,
        description: "Tempo mínimo (em segundos) já incluso na tarifa base"
    },
    maxFreeWaitTime: {
        type: Number,
        default: 300, // 5 minutos
        description: "Tempo máximo de espera gratuita para o motorista (segundos)"
    },
    perMinuteWaitFee: {
        type: Number,
        default: 0.50,
        description: "Taxa por minuto excedente de espera"
    },
    cancellationFee: {
        type: Number,
        default: 5.00,
        description: "Taxa de cancelamento"
    },
    roundingRule: {
        type: String,
        enum: ['none', 'up', 'down', 'nearest'],
        default: 'none',
        description: "Regra de arredondamento do valor final da corrida"
    },
    autoTollCharge: {
        type: Boolean,
        default: false,
        description: "Cobrar pedágio automaticamente"
    },
    showAsEstimate: {
        type: Boolean,
        default: true,
        description: "Exibir ao passageiro que o valor é apenas uma estimativa"
    },
    dynamicPricingStatus: {
        type: String,
        enum: ['off', 'manual', 'auto'],
        default: 'off',
        description: "Status da tarifa dinâmica"
    },
    minMultiplier: {
        type: Number,
        default: 1.0
    },
    maxMultiplier: {
        type: Number,
        default: 3.0
    },
    currentMultiplier: {
        type: Number,
        default: 1.0,
        description: "Usado apenas quando o status for manual"
    },
    weatherProvider: {
        type: String,
        default: 'none',
        description: "Provedor de API de clima (ex: OpenWeatherMap, AccuWeather)"
    },
    automaticRainFee: {
        type: Boolean,
        default: false,
        description: "Ativar taxa de chuva automaticamente via API"
    },
    manualRainFee: {
        type: Boolean,
        default: false,
        description: "Ativar taxa de chuva manualmente pelo painel"
    }
}, { timestamps: true });

module.exports = mongoose.model('tariffSetting', tariffSettingSchema);
