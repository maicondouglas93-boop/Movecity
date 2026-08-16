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

function getElapsedSeconds(ride, now) {
    const base = ride?.startedAt || ride?.createdAt;
    const baseMs = base ? new Date(base).getTime() : now;

    if (!Number.isFinite(baseMs)) return 0;
    return Math.max(0, Math.round((now - baseMs) / 1000));
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

    return {
        amount: pricing.finalFare,
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
