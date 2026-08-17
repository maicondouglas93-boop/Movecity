const PricingEngine = require('./pricingEngine.service');

const LIVE_RIDE_STATUSES = new Set([ 'started', 'ongoing' ]);

function getRideOptionals(ride) {
    const optionals = {};

    if (Array.isArray(ride?.optionals)) {
        ride.optionals.forEach((optional) => {
            const type = typeof optional === 'string' ? optional : optional?.type;
            if (type) optionals[type] = true;
        });
    }

    return optionals;
}

/**
 * Segundos cobráveis da corrida — a MESMA regra que a finalização aplica.
 *
 * O piso de 60s (que troca o tempo real pelo estimado numa corrida muito curta) existia
 * só em endRide. A prévia mostrava o tempo real e a cobrança usava o estimado, então o
 * motorista via um valor na tela e o sistema fechava com outro. Fonte única aqui,
 * consumida pelos dois lados.
 */
function getElapsedSeconds(ride, now) {
    const base = ride?.startedAt || ride?.createdAt;
    const baseMs = base ? new Date(base).getTime() : now;

    if (!Number.isFinite(baseMs)) return 0;
    const elapsed = Math.max(0, Math.round((now - baseMs) / 1000));
    if (elapsed < 60 && ride?.estimatedTime) return ride.estimatedTime;
    return elapsed;
}

/**
 * Calcula o valor corrente usando a mesma regra financeira da finalização.
 * A tarifa congelada no início da corrida continua sendo a fonte de verdade;
 * somente distância e tempo avançam a cada atualização de GPS.
 */
async function calculateLiveRideFare({ ride, actualDistance, now = Date.now() }) {
    if (!ride || !LIVE_RIDE_STATUSES.has(ride.status)) return null;

    const distance = Math.max(0, Number(actualDistance ?? ride.actualDistance) || 0);
    const elapsedSeconds = getElapsedSeconds(ride, now);
    const serviceKind = ride.source === 'driver_initiated' ? 'presential' : 'ride';

    const pricing = await PricingEngine.calculateFare({
        distance,
        time: elapsedSeconds,
        vehicleType: ride.vehicleType,
        paymentMethod: ride.paymentMethod === 'carteira' ? 'pix' : (ride.paymentMethod || 'cash'),
        configSnapshot: ride.pricingSnapshot || null,
        serviceKind,
        waitTimeSeconds: ride.waitTimeSeconds || 0,
        optionals: getRideOptionals(ride),
    });

    // Cupom: a finalização recalcula o desconto sobre o valor real. A prévia ignorava
    // isso e mostrava o valor cheio, então quem tinha cupom via um número maior durante
    // o trajeto do que o cobrado no fim. Mesma função de avaliação, mesmo fallback pro
    // valor congelado quando a promoção não existe mais (ver endRide).
    let amount = pricing.finalFare;
    let discountAmount = 0;
    if (ride.promotionApplied) {
        try {
            const promotionModel = require('../models/promotion.model');
            const promotion = await promotionModel.findById(ride.promotionApplied);
            discountAmount = promotion
                ? require('./promotion.service').evaluateDiscount(promotion, amount).discount
                : Math.min(ride.discountAmount || 0, amount);
            amount = Math.max(0, amount - discountAmount);
        } catch (err) {
            // Uma falha ao ler a promoção não pode esconder o valor corrente da corrida.
            console.error('[LiveFare] desconto não aplicado na prévia:', err.message);
        }
    }

    return {
        amount,
        discountAmount,
        actualDistance: distance,
        elapsedSeconds,
        currency: 'BRL',
        calculatedAt: new Date(now).toISOString(),
        // Auditoria de UX (2026-08-16): relato de motorista mostrando um valor na tela
        // e o sistema fechando com outro maior. A cobrança estava certa — o app só não
        // tinha como mostrar o detalhamento (base/distância/minutos) antes de finalizar,
        // só depois. Expor o mesmo breakdown que a finalização real usa permite ao
        // frontend pedir confirmação com o valor fresco antes de travar a corrida.
        fareBreakdown: pricing.fareBreakdown,
    };
}

module.exports = {
    calculateLiveRideFare,
    getElapsedSeconds,
    getRideOptionals,
};
