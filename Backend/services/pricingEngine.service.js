const TariffSetting = require('../models/tariffSetting.model');
const VehicleCategory = require('../models/vehicleCategory.model');
const PricingRule = require('../models/pricingRule.model');
const GlobalSetting = require('../models/globalSetting.model');
const Coupon = require('../models/coupon.model');

class PricingEngine {
    
    /**
     * Monta um snapshot congelado da configuração de tarifa/comissão pra uma categoria —
     * P2.2 da auditoria de concorrência (2026-08-02). Guardado na corrida no momento da
     * criação (`createRide`) e reutilizado no fim da corrida (`endRide`) pra recalcular o
     * preço final só com base na distância/tempo reais, sem sofrer efeito de mudanças de
     * tarifa/comissão feitas pelo admin enquanto a corrida já estava em andamento.
     * @param {Object} params
     * @param {String} params.vehicleType Nome da categoria (ex: 'car')
     * @returns {Object} snapshot pronto pra passar como `configSnapshot` em calculateFare
     */
    static async buildConfigSnapshot({ vehicleType }) {
        const [tariffSetting, globalSetting, category, rules] = await PricingEngine._fetchLiveConfig(vehicleType);

        if (!category) {
            throw new Error(`Categoria de veículo '${vehicleType}' não encontrada ou inativa.`);
        }

        return {
            tariffSetting: tariffSetting ? tariffSetting.toObject() : {},
            globalSetting: globalSetting ? globalSetting.toObject() : { platformCommission: 20, cardFeePercent: 0, cardFeeFixed: 0 },
            category: category.toObject(),
            rules: rules.map(r => r.toObject()),
            capturedAt: new Date()
        };
    }

    static async _fetchLiveConfig(vehicleType) {
        return Promise.all([
            TariffSetting.findOne(),
            GlobalSetting.findOne(),
            VehicleCategory.findOne({ name: vehicleType, isActive: true }),
            PricingRule.find({ isActive: true }).sort({ priority: 1 })
        ]);
    }

    /**
     * Calcula a tarifa completa da corrida.
     * @param {Object} params
     * @param {Number} params.distance Distância em metros
     * @param {Number} params.time Tempo estimado em segundos
     * @param {String} params.vehicleType Nome da categoria (ex: 'car')
     * @param {String} params.paymentMethod (opcional) 'cash', 'card', 'pix'
     * @param {String} params.couponCode (opcional) Código do cupom
     * @param {Date} params.requestDate (opcional) Data da solicitação
     * @param {Object} params.configSnapshot (opcional) Snapshot de `buildConfigSnapshot` —
     *   quando presente, usa essa configuração congelada em vez de consultar o banco de
     *   novo (P2.2 da auditoria de concorrência). Ausente (padrão): comportamento de
     *   sempre, consulta a configuração vigente — usado pra cotações (`getFare`) e pra
     *   montar o snapshot inicial em `createRide`.
     * @returns {Object} { finalFare, fareBreakdown, commissionAmount }
     */
    static async calculateFare({ distance, time, vehicleType, paymentMethod = 'cash', couponCode = null, requestDate = new Date(), configSnapshot = null }) {

        // 1. Carregar Configurações Globais e do Veículo — do snapshot congelado, se vier
        // um, senão consulta o banco (comportamento de sempre).
        let tariffSetting, globalSetting, category, rules;
        if (configSnapshot) {
            ({ tariffSetting, globalSetting, category, rules } = configSnapshot);
        } else {
            [tariffSetting, globalSetting, category, rules] = await PricingEngine._fetchLiveConfig(vehicleType);
        }

        tariffSetting = tariffSetting || {};
        globalSetting = globalSetting || { platformCommission: 20, cardFeePercent: 0, cardFeeFixed: 0 };
        rules = rules || [];

        if (!category) {
            throw new Error(`Categoria de veículo '${vehicleType}' não encontrada ou inativa.`);
        }

        // Setup variáveis do breakdown
        const breakdown = {
            baseFare: category.baseFare,
            distanceFare: 0,
            timeFare: 0,
            appliedRules: [],
            dynamicMultiplier: 1.0,
            cardFee: 0,
            couponDiscount: 0,
            platformCommission: 0,
            finalFare: 0,
            driverNetEarnings: 0
        };

        // 2. Cálculo Base + KM + Tempo
        const minDistanceMeters = (tariffSetting.minDistanceIncluded || 0) * 1000;
        const minTimeSeconds = (tariffSetting.minTimeIncluded || 0) * 60;

        const chargeableDistance = Math.max(0, distance - minDistanceMeters);
        const chargeableTime = Math.max(0, time - minTimeSeconds);

        breakdown.distanceFare = (chargeableDistance / 1000) * category.perKmRate;
        breakdown.timeFare = (chargeableTime / 60) * category.perMinuteRate;

        let subtotal = breakdown.baseFare + breakdown.distanceFare + breakdown.timeFare;

        // 3. Aplicar Mínimos e Máximos da Categoria
        if (subtotal < category.minFare) {
            subtotal = category.minFare;
        }
        if (category.maxFare && subtotal > category.maxFare) {
            subtotal = category.maxFare;
        }

        // 4. Aplicar PricingRules
        for (const rule of rules) {
            if (PricingEngine._evaluateRuleConditions(rule)) {
                let ruleAmount = 0;
                if (rule.modificationType === 'fixed') {
                    ruleAmount = rule.value;
                    subtotal += ruleAmount;
                } else if (rule.modificationType === 'percentage') {
                    ruleAmount = subtotal * (rule.value / 100);
                    subtotal += ruleAmount;
                }
                
                breakdown.appliedRules.push({
                    name: rule.name,
                    amount: ruleAmount
                });
            }
        }

        // 5. Aplicar Dynamic Pricing
        let globalMult = 1.0;
        if (tariffSetting.dynamicPricingStatus === 'manual' || tariffSetting.dynamicPricingStatus === 'auto') {
            globalMult = tariffSetting.currentMultiplier || 1.0;
            
            // Garantir os limites globais
            if (globalMult < (tariffSetting.minMultiplier || 1.0)) globalMult = tariffSetting.minMultiplier;
            if (globalMult > (tariffSetting.maxMultiplier || 3.0)) globalMult = tariffSetting.maxMultiplier;
        }

        // Multiplicador da categoria de veículo
        const categoryMult = category.dynamicMultiplier || 1.0;
        const categoryRainMult = tariffSetting.manualRainFee ? (category.rainFeeMultiplier || 1.0) : 1.0;

        const finalMultiplier = globalMult * categoryMult * categoryRainMult;

        breakdown.dynamicMultiplier = finalMultiplier;
        subtotal = subtotal * finalMultiplier;

        // 6. Fee de Cartão (Apenas sobre o subtotal atual)
        if (paymentMethod === 'card') {
            const fee = (subtotal * (globalSetting.cardFeePercent / 100)) + globalSetting.cardFeeFixed;
            breakdown.cardFee = fee;
            subtotal += fee;
        }

        // A comissão da plataforma incide sobre o valor SEM a taxa do cartão e SEM descontos do cupom
        const baseForCommission = subtotal - breakdown.cardFee;
        breakdown.platformCommission = baseForCommission * (globalSetting.platformCommission / 100);

        // 7. Cupons de Desconto
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
            if (coupon && coupon.expirationDate > requestDate && coupon.usedCount < coupon.usageLimit) {
                let discount = 0;
                if (coupon.type === 'fixed') {
                    discount = coupon.value;
                } else {
                    discount = subtotal * (coupon.value / 100);
                    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                        discount = coupon.maxDiscount;
                    }
                }
                breakdown.couponDiscount = discount;
                subtotal -= discount;
                if (subtotal < 0) subtotal = 0;
            }
        }

        // 8. Arredondamento Final
        let finalFare = subtotal;
        if (tariffSetting.roundingRule === 'up') finalFare = Math.ceil(finalFare);
        else if (tariffSetting.roundingRule === 'down') finalFare = Math.floor(finalFare);
        else if (tariffSetting.roundingRule === 'nearest') finalFare = Math.round(finalFare);
        
        breakdown.finalFare = finalFare;
        breakdown.driverNetEarnings = finalFare - breakdown.platformCommission;

        // Formatar para 2 casas decimais para limpeza de floats
        for (const key in breakdown) {
            if (typeof breakdown[key] === 'number') {
                breakdown[key] = parseFloat(breakdown[key].toFixed(2));
            }
        }
        
        // Também formatar valores no array appliedRules
        breakdown.appliedRules = breakdown.appliedRules.map(rule => ({
            ...rule,
            amount: parseFloat(rule.amount.toFixed(2))
        }));

        return {
            finalFare: breakdown.finalFare,
            commissionAmount: breakdown.platformCommission,
            fareBreakdown: breakdown
        };
    }

    /**
     * Decide se uma PricingRule deve ser aplicada nesta corrida.
     * Uma regra só é aplicada quando suas `conditions` são de fato verificadas — nunca
     * por padrão. Antes, uma regra sem `conditions` era aplicada sempre (e uma regra COM
     * `conditions` nunca era avaliada, pois a avaliação não existe ainda), o que fez a
     * regra "Taxa de Chuva" ser cobrada em toda corrida independente do clima.
     */
    static _evaluateRuleConditions(rule) {
        if (!rule.conditions || Object.keys(rule.conditions).length === 0) {
            return false;
        }

        // Avaliação de condições (horário, dia da semana, clima real via weatherProvider,
        // polígonos de zona, etc.) ainda não está implementada para nenhum tipo de regra.
        // Até existir, nenhuma regra com condições é aplicada — mais seguro do que cobrar
        // uma taxa cuja condição nunca foi de fato checada.
        return false;
    }
}

module.exports = PricingEngine;
