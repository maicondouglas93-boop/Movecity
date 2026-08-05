const {
    maskApiKey,
    pct,
    healthFromPercent,
    shiftDayKey,
    monthBounds,
    GOOGLE_MAPS_SKUS,
} = require('../../services/monitoring/constants');

describe('monitoring constants', () => {
    it('mascara API keys sem expor o valor completo', () => {
        expect(maskApiKey('AIzaSyDummyKey1234567890')).toMatch(/^AIza…/);
        expect(maskApiKey('AIzaSyDummyKey1234567890')).toMatch(/7890$/);
        expect(maskApiKey('')).toBe('não configurada');
        expect(maskApiKey(null)).toBe('não configurada');
    });

    it('calcula percentual e health', () => {
        expect(pct(50, 100)).toBe(50);
        expect(pct(0, 100)).toBe(0);
        expect(pct(10, 0)).toBeNull();
        expect(healthFromPercent(40)).toBe('healthy');
        expect(healthFromPercent(60)).toBe('attention');
        expect(healthFromPercent(95)).toBe('critical');
    });

    it('desloca dayKey e calcula bounds do mês', () => {
        expect(shiftDayKey('2026-08-05', -1)).toBe('2026-08-04');
        const bounds = monthBounds(new Date('2026-08-05T12:00:00.000Z'));
        expect(bounds.from).toBe('2026-08-01');
        expect(bounds.to).toBe('2026-08-31');
        expect(bounds.dayOfMonth).toBe(5);
    });

    it('expõe SKUs do Google Maps usados pelo painel', () => {
        expect(GOOGLE_MAPS_SKUS.geocoding).toBeDefined();
        expect(GOOGLE_MAPS_SKUS.places_autocomplete).toBeDefined();
        expect(GOOGLE_MAPS_SKUS.routes).toBeDefined();
    });
});
