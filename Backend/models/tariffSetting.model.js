const mongoose = require('mongoose');

// Auditoria de concorrência do painel administrativo (2026-08-02, Bloco E, achado C1):
// dois admins editando a mesma tarifa ao mesmo tempo — o segundo save() sobrescrevia o
// primeiro sem aviso nenhum. optimisticConcurrency faz o save() usar o __v lido como
// filtro da escrita: se alguém mudou o documento entre a leitura e a gravação, o
// segundo save() lança VersionError em vez de sobrescrever silenciosamente.
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
    // Bloco H (2026-08-02, §6): autoTollCharge removido — cobrar pedágio automaticamente
    // exigiria uma API de rotas com pedágio, que não existe no projeto. Nenhum caminho
    // de implementação parcial existia; ver docs/plans/2026-08-02-execucao-bloco-h-admin-regras-negocio.md.
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
    // Bloco H (2026-08-02, achado F13): weatherProvider e automaticRainFee removidos —
    // nenhuma integração de API de clima existe no projeto, e nenhum admin conseguia
    // sequer ativar automaticRainFee pelo painel (não tinha controle na UI). manualRainFee
    // é o único jeito real de ativar taxa de chuva hoje.
    manualRainFee: {
        type: Boolean,
        default: false,
        description: "Ativar taxa de chuva manualmente pelo painel"
    },
    // Auditoria APK↔tarifas (2026-08-06): preços de opcionais estavam hardcoded em
    // ride.service.createRide — o admin não tinha como mudar. Congelados no
    // pricingSnapshot.tariffSetting junto com o resto da tarifa da corrida.
    optionalPrices: {
        porta_malas: { type: Number, default: 0, min: 0 },
        aceita_animais: { type: Number, default: 3, min: 0 },
        aceita_encomendas: { type: Number, default: 5, min: 0 },
        adaptado_cadeirante: { type: Number, default: 0, min: 0 },
        disposicao_passageiro: { type: Number, default: 15, min: 0 },
    },
}, { timestamps: true, optimisticConcurrency: true });

const DEFAULT_OPTIONAL_PRICES = {
    porta_malas: 0,
    aceita_animais: 3,
    aceita_encomendas: 5,
    adaptado_cadeirante: 0,
    disposicao_passageiro: 15,
};

const TariffSetting = mongoose.model('tariffSetting', tariffSettingSchema);
TariffSetting.DEFAULT_OPTIONAL_PRICES = DEFAULT_OPTIONAL_PRICES;
module.exports = TariffSetting;
