const TariffSetting = require('../models/tariffSetting.model');
const VehicleCategory = require('../models/vehicleCategory.model');
const PricingRule = require('../models/pricingRule.model');
const GlobalSetting = require('../models/globalSetting.model');
const Coupon = require('../models/coupon.model');

class PricingEngine {
    
    /**
     * Calcula a tarifa completa da corrida.
     * @param {Object} params
     * @param {Number} params.distance Distância em metros
     * @param {Number} params.time Tempo estimado em segundos
     * @param {String} params.vehicleType Nome da categoria (ex: 'car')
     * @param {String} params.paymentMethod (opcional) 'cash', 'card', 'pix'
     * @param {String} params.couponCode (opcional) Código do cupom
     * @param {Date} params.requestDate (opcional) Data da solicitação
     * @returns {Object} { finalFare, fareBreakdown, commissionAmount }
     */
    static async calculateFare({ distance, time, vehicleType, paymentMethod = 'cash', couponCode = null, requestDate = new Date() }) {
        
        // 1. Carregar Configurações Globais e do Veículo
        let [tariffSetting, globalSetting, category, rules] = await Promise.all([
            TariffSetting.findOne(),
            GlobalSetting.findOne(),
            VehicleCategory.findOne({ name: vehicleType, isActive: true }),
            PricingRule.find({ isActive: true }).sort({ priority: 1 })
        ]);

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
            let applyRule = false;

            // Para simplificar a POC, se for type 'custom' ou 'always_on' sem condições, aplicamos direto.
            if (!rule.conditions || Object.keys(rule.conditions).length === 0) {
                applyRule = true;
            } else {
                // Aqui podemos expandir a lógica (dias da semana, clima real)
            }

            if (applyRule) {
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
        if (tariffSetting.dynamicPricingStatus === 'manual' || tariffSetting.dynamicPricingStatus === 'auto') {
            let mult = tariffSetting.currentMultiplier || 1.0;
            
            // Garantir os limites
            if (mult < (tariffSetting.minMultiplier || 1.0)) mult = tariffSetting.minMultiplier;
            if (mult > (tariffSetting.maxMultiplier || 3.0)) mult = tariffSetting.maxMultiplier;

            breakdown.dynamicMultiplier = mult;
            subtotal = subtotal * mult;
        }

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
}

module.exports = PricingEngine;
