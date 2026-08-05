const {
    resolvePlatformCommission,
    normalizePlatformCommissionsPatch,
    buildPlatformCommissionsFromLegacy,
} = require('../../utils/platformCommission');

describe('platformCommission utils', () => {
    it('resolvePlatformCommission usa nested por kind', () => {
        const gs = {
            platformCommission: 20,
            platformCommissions: { ride: 15, presential: 10, parcel: 25 },
        };
        expect(resolvePlatformCommission(gs, 'ride')).toBe(15);
        expect(resolvePlatformCommission(gs, 'presential')).toBe(10);
        expect(resolvePlatformCommission(gs, 'parcel')).toBe(25);
    });

    it('resolvePlatformCommission cai no legado quando nested ausente', () => {
        expect(resolvePlatformCommission({ platformCommission: 18 }, 'parcel')).toBe(18);
        expect(resolvePlatformCommission({}, 'ride')).toBe(20);
    });

    it('normalizePlatformCommissionsPatch atualiza só ride quando patch legado', () => {
        const current = {
            platformCommission: 20,
            platformCommissions: { ride: 20, presential: 12, parcel: 8 },
        };
        const next = normalizePlatformCommissionsPatch({ platformCommission: 30 }, current);
        expect(next.ride).toBe(30);
        expect(next.presential).toBe(12);
        expect(next.parcel).toBe(8);
    });

    it('buildPlatformCommissionsFromLegacy clona o legado nos três', () => {
        expect(buildPlatformCommissionsFromLegacy({ platformCommission: 22 })).toEqual({
            ride: 22,
            presential: 22,
            parcel: 22,
        });
    });
});
