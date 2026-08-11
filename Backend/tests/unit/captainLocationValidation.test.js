const {
    MAX_LOCATION_AGE_MS,
    normalizeCaptainLocation,
    isPlausibleTravel,
} = require('../../utils/captainLocationValidation');

describe('captain location validation', () => {
    const now = 1_700_000_000_000;

    it('accepts a fresh, valid coordinate', () => {
        const result = normalizeCaptainLocation({
            ltd: -23.5505,
            lng: -46.6333,
            accuracy: 12,
            timestamp: now - 5000,
        }, now);

        expect(result).toMatchObject({
            valid: true,
            isAccurateForFare: true,
            location: { lat: -23.5505, lng: -46.6333, accuracy: 12 },
        });
    });

    it('rejects invalid and stale coordinates', () => {
        expect(normalizeCaptainLocation({ ltd: 91, lng: 0 }, now)).toMatchObject({
            valid: false,
            code: 'INVALID_COORDINATES',
        });
        expect(normalizeCaptainLocation({ ltd: 0, lng: 0, timestamp: now - MAX_LOCATION_AGE_MS - 1 }, now)).toMatchObject({
            valid: false,
            code: 'STALE_LOCATION',
        });
    });

    it('keeps imprecise or physically implausible points out of fare accumulation', () => {
        expect(normalizeCaptainLocation({ ltd: -23.5, lng: -46.6, accuracy: 101, timestamp: now }, now))
            .toMatchObject({ valid: true, isAccurateForFare: false });
        expect(isPlausibleTravel(350, 5000)).toBe(false);
        expect(isPlausibleTravel(250, 5000)).toBe(true);
    });
});
