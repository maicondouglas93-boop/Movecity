// PricingEngine.calculateFare lê VehicleCategory.findOne({name: vehicleType, isActive:
// true}) — sem isso, qualquer /rides/create ou /parcels/create falha. Mesma forma
// usada em tests/unit/rideEstimateVsActual.service.test.js (auditoria estimativa ×
// valor final, 2026-08-08) — números repetidos de propósito para os relatórios dos
// dois trabalhos falarem a mesma língua.
const VehicleCategory = require('../../../models/vehicleCategory.model');

async function seedCarCategory(overrides = {}) {
    const pricing = {
        baseFare: 10,
        perKm: 2,
        perMinute: 0.5,
        minimumFare: 15,
        platformCommission: 20,
        parcelAdjustment: { isActive: false, type: 'percentage', value: 0 },
        optionals: [],
        ...overrides.pricing,
    };
    return VehicleCategory.create({
        name: 'car',
        displayName: 'Carro Econômico (SIMULATOR)',
        isActive: true,
        baseFare: pricing.baseFare,
        perKmRate: pricing.perKm,
        perMinuteRate: pricing.perMinute,
        minFare: pricing.minimumFare,
        pricing,
        ...overrides,
    });
}

module.exports = { seedCarCategory };
