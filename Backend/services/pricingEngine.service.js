const TariffSetting = require('../models/tariffSetting.model');
const VehicleCategory = require('../models/vehicleCategory.model');
const GlobalSetting = require('../models/globalSetting.model');
const Coupon = require('../models/coupon.model');

class PricingEngine {
    
    /**
     * Monta um snapshot congelado da configuração de tarifa/comissão.
     * Agora usa a tabela de categoria (VehicleCategory) como fonte da verdade.
     */
    static async buildConfigSnapshot({ vehicleType, serviceKind = 'ride' }) {
        const category = await VehicleCategory.findOne({ name: vehicleType, isActive: true });

        if (!category) {
            throw new Error(`Categoria de veículo '${vehicleType}' não encontrada ou inativa.`);
        }

        const globalSetting = await GlobalSetting.findOne();
        const gsPlain = globalSetting ? (typeof globalSetting.toObject === 'function' ? globalSetting.toObject() : { ...globalSetting }) : {
            cardFeePercent: 0,
            cardFeeFixed: 0,
        };

        return {
            category: category.toObject(),
            globalSetting: gsPlain,
            serviceKind,
            capturedAt: new Date()
        };
    }

    /**
     * Calcula a tarifa de cancelamento com base no config congelado.
     */
    static async calculateCancellationFee({ configSnapshot }) {
        let category = configSnapshot?.category;
        
        // Se a chamada não passar configSnapshot, precisamos de um veículo. Como o cancelamento
        // geralmente vem do ride, quem chamar (ride.service) DEVE passar o snapshot para ter precisão.
        if (!category && configSnapshot && configSnapshot.vehicleType) {
            const catDoc = await VehicleCategory.findOne({ name: configSnapshot.vehicleType, isActive: true });
            category = catDoc ? catDoc.toObject() : null;
        }

        if (category && category.pricing && category.pricing.surcharges?.cancellation?.active) {
            return category.pricing.surcharges.cancellation.value || 0;
        }
        
        // Fallback genérico se não tiver snapshot nem veículo
        return 5.0; 
    }

    /**
     * Calcula a tarifa completa da corrida.
     * @param {Object} params
     * @param {Number} params.distance Distância em metros
     * @param {Number} params.time Tempo estimado (ou real) em segundos
     * @param {String} params.vehicleType Nome da categoria (ex: 'car')
     * @param {String} params.paymentMethod 'cash', 'card', 'pix'
     * @param {String} params.couponCode (opcional) Código do cupom
     * @param {Date} params.requestDate (opcional) Data da solicitação
     * @param {Object} params.configSnapshot (opcional) Snapshot de `buildConfigSnapshot`
     * @param {String} [params.serviceKind='ride'] 'ride' | 'presential' | 'parcel'
     * @param {Number} params.waitTimeSeconds (opcional) Tempo real de espera do motorista em segundos
     * @param {Number} params.extraStopsCount (opcional) Quantidade de paradas extras
     * @param {Object} params.optionals (opcional) Opções selecionadas { porta_malas: true, aceita_animais: true, ... }
     * @returns {Object} { finalFare, fareBreakdown, commissionAmount, driverEarnings }
     */
    static async calculateFare({
        distance,
        time,
        vehicleType,
        paymentMethod = 'cash',
        couponCode = null,
        requestDate = new Date(),
        configSnapshot = null,
        serviceKind = 'ride',
        waitTimeSeconds = 0,
        extraStopsCount = 0,
        optionals = {}
    }) {
        let category, gs;
        if (configSnapshot && configSnapshot.category) {
            category = configSnapshot.category;
            gs = configSnapshot.globalSetting || {};
        } else {
            const liveConfig = await PricingEngine.buildConfigSnapshot({ vehicleType, serviceKind });
            category = liveConfig.category;
            gs = liveConfig.globalSetting || {};
        }

        if (!category) {
            throw new Error(`Categoria de veículo '${vehicleType}' não encontrada ou inativa.`);
        }

        // Lógica puramente focada no VehicleCategory
        const pricing = category.pricing || {};
        const baseFare = pricing.baseFare ?? category.baseFare ?? 5.00;
        const perKm = pricing.perKm ?? category.perKmRate ?? 2.00;
        const perMinute = pricing.perMinute ?? category.perMinuteRate ?? 0.50;
        const minimumFare = pricing.minimumFare ?? category.minFare ?? 7.00;
        const platformCommissionPct = pricing.platformCommission ?? 20;

        const breakdown = {
            baseFare: baseFare,
            distanceFare: 0,
            timeFare: 0,
            minimumFareAdjustment: 0,
            surcharges: {
                night: 0,
                rain: 0,
                waiting: 0,
                extraStops: 0,
                optionals: 0
            },
            discounts: {
                coupon: 0
            },
            subtotal: 0,
            finalFare: 0,
            platformCommission: 0,
            driverEarnings: 0
        };

        // 1. Cálculo Base + KM + Tempo
        const minDistanceMeters = (pricing.minDistanceIncluded || 0) * 1000;
        const minTimeSeconds = (pricing.minTimeIncluded || 0) * 60;

        const chargeableDistance = Math.max(0, distance - minDistanceMeters);
        const chargeableTime = Math.max(0, time - minTimeSeconds);

        breakdown.distanceFare = (chargeableDistance / 1000) * perKm;
        breakdown.timeFare = (chargeableTime / 60) * perMinute;

        let currentSubtotal = breakdown.baseFare + breakdown.distanceFare + breakdown.timeFare;

        // 2. Mínimo
        if (currentSubtotal < minimumFare) {
            breakdown.minimumFareAdjustment = minimumFare - currentSubtotal;
            currentSubtotal = minimumFare;
        }

        // 3. Adicionais e Condições (Surcharges)
        
        // 3.1. Tempo de Espera
        let waitingCharge = 0;
        const waitConfig = pricing.surcharges?.waiting || {
            active: true,
            freeMinutes: 5,
            valuePerMinute: 0.5
        };
        if (waitConfig.active && waitTimeSeconds > 0) {
            const freeSeconds = (waitConfig.freeMinutes || 0) * 60;
            const chargeableWaitSeconds = Math.max(0, waitTimeSeconds - freeSeconds);
            waitingCharge = (chargeableWaitSeconds / 60) * (waitConfig.valuePerMinute || 0);
        }
        breakdown.surcharges.waiting = waitingCharge;

        // 3.2. Opcionais Dinâmicos (Adicionais)
        let optionalsCharge = 0;
        if (optionals && pricing.optionals) {
            for (const key in optionals) {
                if (optionals[key]) {
                    const foundOpt = pricing.optionals.find(opt => opt.id === key && opt.isActive);
                    if (foundOpt) {
                        optionalsCharge += foundOpt.value;
                    }
                }
            }
        }
        breakdown.surcharges.optionals = optionalsCharge;

        // 3.3. Paradas Extras
        let extraStopsCharge = 0;
        const stopsConfig = pricing.surcharges?.extraStops || { active: false, valuePerStop: 0 };
        if (stopsConfig.active && extraStopsCount > 0) {
            extraStopsCharge = extraStopsCount * (stopsConfig.valuePerStop || 0);
        }
        breakdown.surcharges.extraStops = extraStopsCharge;

        // 3.4. Noturno (Night Mode)
        let nightCharge = 0;
        const nightConfig = pricing.surcharges?.night || { active: false, type: 'percent', value: 0 };
        if (nightConfig.active) {
            const reqHour = requestDate.getHours();
            const reqMin = requestDate.getMinutes();
            const currentTime = reqHour + (reqMin / 60);
            
            const parseTime = (str) => {
                const [h, m] = (str || '00:00').split(':').map(Number);
                return h + (m / 60);
            };
            const startT = parseTime(nightConfig.startTime);
            const endT = parseTime(nightConfig.endTime);
            
            let isNight = false;
            if (startT > endT) { // Cruzou meia-noite
                if (currentTime >= startT || currentTime <= endT) isNight = true;
            } else {
                if (currentTime >= startT && currentTime <= endT) isNight = true;
            }

            if (isNight) {
                if (nightConfig.type === 'fixed') {
                    nightCharge = nightConfig.value || 0;
                } else {
                    nightCharge = currentSubtotal * ((nightConfig.value || 0) / 100);
                }
            }
        }
        breakdown.surcharges.night = nightCharge;

        // 3.5. Chuva / Clima
        let rainCharge = 0;
        const rainConfig = pricing.surcharges?.rain || { active: false, type: 'percent', value: 0 };
        if (rainConfig.active) {
            if (rainConfig.type === 'fixed') {
                rainCharge = rainConfig.value || 0;
            } else {
                const percent = rainConfig.value > 0 ? rainConfig.value : ((category.rainFeeMultiplier || 1) - 1) * 100;
                rainCharge = currentSubtotal * (percent / 100);
            }
        }
        breakdown.surcharges.rain = rainCharge;

        // Soma surcharges
        currentSubtotal += (waitingCharge + optionalsCharge + extraStopsCharge + nightCharge + rainCharge);
        breakdown.subtotal = currentSubtotal;

        // 4. Taxa de Cartão (opcional - legado globalSetting)
        let cardFee = 0;
        if (paymentMethod === 'card') {
            cardFee = (currentSubtotal * ((gs.cardFeePercent || 0) / 100)) + (gs.cardFeeFixed || 0);
            currentSubtotal += cardFee;
        }

        // 5. Cupons de Desconto
        let couponDiscount = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
            if (coupon && coupon.expirationDate > requestDate && coupon.usedCount < coupon.usageLimit) {
                if (coupon.type === 'fixed') {
                    couponDiscount = coupon.value;
                } else {
                    couponDiscount = currentSubtotal * (coupon.value / 100);
                    if (coupon.maxDiscount && couponDiscount > coupon.maxDiscount) {
                        couponDiscount = coupon.maxDiscount;
                    }
                }
                currentSubtotal -= couponDiscount;
                if (currentSubtotal < 0) currentSubtotal = 0;
            }
        }
        breakdown.discounts.coupon = couponDiscount;

        // 6. Arredondamento
        let finalFare = currentSubtotal;
        if (pricing.roundingRule === 'up') finalFare = Math.ceil(finalFare);
        else if (pricing.roundingRule === 'down') finalFare = Math.floor(finalFare);
        else if (pricing.roundingRule === 'nearest') finalFare = Math.round(finalFare);

        // 7. Comissão (Incidindo sobre tudo que o passageiro paga, mas descontando taxa do cartão)
        const baseForCommission = Math.max(0, finalFare - cardFee);
        const commissionAmount = baseForCommission * (platformCommissionPct / 100);

        const driverEarnings = finalFare - commissionAmount;

        breakdown.finalFare = finalFare;
        breakdown.platformCommission = commissionAmount;
        breakdown.driverEarnings = driverEarnings;

        // Formatação
        const formatDecimals = (obj) => {
            for (const key in obj) {
                if (typeof obj[key] === 'number') {
                    obj[key] = parseFloat(obj[key].toFixed(2));
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    formatDecimals(obj[key]);
                }
            }
        };
        formatDecimals(breakdown);

        return {
            finalFare: breakdown.finalFare,
            commissionAmount: breakdown.platformCommission,
            driverEarnings: breakdown.driverEarnings,
            fareBreakdown: breakdown
        };
    }
}

module.exports = PricingEngine;
