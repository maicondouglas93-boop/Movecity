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

    // --- NOVO MODELO UNIFICADO (Unified Pricing Engine) ---
    // Estes campos representam a única fonte de verdade para cálculos de tarifas a partir de agora.
    // Os valores antigos em vehicleCategory, parcelSetting e globalSetting estão obsoletos.
    baseFare: { type: Number, default: 5.00 },
    perKm: { type: Number, default: 2.00 },
    perMinute: { type: Number, default: 0.50 },
    minimumFare: { type: Number, default: 7.00 },
    platformCommission: { type: Number, default: 20 }, // Comissão centralizada (porcentagem)

    surcharges: {
        night: {
            active: { type: Boolean, default: false },
            startTime: { type: String, default: '22:00' },
            endTime: { type: String, default: '06:00' },
            type: { type: String, enum: ['fixed', 'percent'], default: 'percent' },
            value: { type: Number, default: 20 },
        },
        rain: {
            active: { type: Boolean, default: false },
            type: { type: String, enum: ['fixed', 'percent'], default: 'percent' },
            value: { type: Number, default: 20 },
        },
        waiting: {
            active: { type: Boolean, default: true },
            freeMinutes: { type: Number, default: 5 },
            valuePerMinute: { type: Number, default: 0.50 },
        },
        extraStops: {
            active: { type: Boolean, default: false },
            valuePerStop: { type: Number, default: 3.00 },
        },
        cancellation: {
            active: { type: Boolean, default: true },
            value: { type: Number, default: 5.00 },
        }
    }
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
