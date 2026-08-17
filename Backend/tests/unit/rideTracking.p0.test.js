const mockState = {};

jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.fn((aLat, aLng, bLat, bLng) => {
        const toRad = value => (value * Math.PI) / 180;
        const earthKm = 6371;
        const dLat = toRad(bLat - aLat);
        const dLng = toRad(bLng - aLng);
        const value = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
        return earthKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    }),
}));

function mockSameDate(left, right) {
    return new Date(left).getTime() === new Date(right).getTime();
}

function mockFilterMatches(filter) {
    if (filter.status && mockState.status !== filter.status) return false;
    if (filter.finalizationState?.$ne && mockState.finalizationState === filter.finalizationState.$ne) return false;
    if (
        filter.processedTrackingPointIds?.$ne
        && mockState.processedTrackingPointIds.includes(filter.processedTrackingPointIds.$ne)
    ) return false;
    if (filter['lastLocation.lat'] != null && mockState.lastLocation?.lat !== filter['lastLocation.lat']) return false;
    if (filter['lastLocation.lng'] != null && mockState.lastLocation?.lng !== filter['lastLocation.lng']) return false;
    if (filter.lastLocationAt && !mockSameDate(mockState.lastLocationAt, filter.lastLocationAt)) return false;
    return true;
}

jest.mock('../../models/ride.model', () => ({
    findOne: jest.fn(() => ({
        select: jest.fn(async () => ({ ...mockState, processedTrackingPointIds: [...mockState.processedTrackingPointIds] })),
    })),
    findOneAndUpdate: jest.fn(async (filter, update) => {
        if (!mockFilterMatches(filter)) return null;
        if (update.$inc?.actualDistance) mockState.actualDistance += update.$inc.actualDistance;
        if (update.$set) Object.assign(mockState, update.$set);
        if (update.$addToSet?.processedTrackingPointIds) {
            const pointId = update.$addToSet.processedTrackingPointIds;
            if (!mockState.processedTrackingPointIds.includes(pointId)) mockState.processedTrackingPointIds.push(pointId);
        }
        // A lista de pontos processados passou a ser podada ($push + $slice negativo)
        // para não crescer sem limite durante a corrida. O `$ne` no filtro continua
        // sendo o que garante idempotência; o $slice só descarta os mais antigos.
        const pushed = update.$push?.processedTrackingPointIds;
        if (pushed) {
            const ids = pushed.$each || [pushed];
            ids.forEach((pointId) => {
                if (!mockState.processedTrackingPointIds.includes(pointId)) {
                    mockState.processedTrackingPointIds.push(pointId);
                }
            });
            if (typeof pushed.$slice === 'number' && pushed.$slice < 0) {
                mockState.processedTrackingPointIds = mockState.processedTrackingPointIds.slice(pushed.$slice);
            }
        }
        return { ...mockState };
    }),
}));

const { processRideTrackingPoint } = require('../../services/rideTracking.service');

const A = { lat: -19.5586, lng: -41.6803 };
// Ponto de retorno sintético a ~40 km: representa Lajinha -> Manhuaçu no cenário
// financeiro de ida/volta sem depender de API de rotas no teste unitário.
const B = { lat: A.lat - 0.36, lng: A.lng };

function createStartedRide(overrides = {}) {
    const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, {
        _id: 'ride1',
        captain: 'cap1',
        status: 'started',
        finalizationState: undefined,
        actualDistance: 0,
        processedTrackingPointIds: [],
        startedAt,
        lastLocation: { ...A },
        lastLocationAt: startedAt,
        ...overrides,
    });
    return { ride: mockState, captainId: 'cap1', startedAt };
}

describe('tracking GPS P0', () => {
    it('aceita os ~80 km da ida/volta mesmo terminando na origem', async () => {
        const { ride, captainId, startedAt } = createStartedRide();
        const outbound = await processRideTrackingPoint({
            rideId: ride._id,
            captainId,
            pointId: 'outbound',
            location: { ltd: B.lat, lng: B.lng, accuracy: 10, timestamp: startedAt.getTime() + 30 * 60 * 1000 },
        });
        const inbound = await processRideTrackingPoint({
            rideId: ride._id,
            captainId,
            pointId: 'inbound',
            location: { ltd: A.lat, lng: A.lng, accuracy: 10, timestamp: startedAt.getTime() + 60 * 60 * 1000 },
        });

        expect(outbound.accepted).toBe(true);
        expect(outbound.countedDistanceMeters).toBeGreaterThan(2000);
        expect(inbound.accepted).toBe(true);
        expect(mockState.actualDistance).toBeCloseTo(outbound.countedDistanceMeters * 2, 3);
        expect(mockState.actualDistance).toBeGreaterThan(70000);
        expect(mockState.actualDistance).toBeLessThan(90000);
        expect(mockState.lastLocation.lat).toBeCloseTo(A.lat, 6);
        expect(mockState.processedTrackingPointIds).toEqual(expect.arrayContaining(['outbound', 'inbound']));
    });

    it('replay do mesmo pointId é idempotente e não duplica distância', async () => {
        const { ride, captainId, startedAt } = createStartedRide();
        const input = {
            rideId: ride._id,
            captainId,
            pointId: 'same-point',
            location: {
                ltd: B.lat,
                lng: B.lng,
                accuracy: 10,
                timestamp: startedAt.getTime() + 30 * 60 * 1000,
            },
        };
        const first = await processRideTrackingPoint(input);
        const second = await processRideTrackingPoint(input);

        expect(second.duplicate).toBe(true);
        expect(mockState.actualDistance).toBeCloseTo(first.countedDistanceMeters, 8);
    });

    it('rejeita salto impossível sem substituir o último ponto válido', async () => {
        const { ride, captainId, startedAt } = createStartedRide();
        const impossible = await processRideTrackingPoint({
            rideId: ride._id,
            captainId,
            pointId: 'outlier',
            location: {
                ltd: A.lat + 2,
                lng: A.lng + 2,
                accuracy: 5,
                timestamp: startedAt.getTime() + 60 * 1000,
            },
        });

        expect(impossible.accepted).toBe(false);
        expect(impossible.reason).toBe('IMPLAUSIBLE_TRAVEL');
        expect(mockState.actualDistance).toBe(0);
        expect(mockState.lastLocation).toEqual(A);
    });

    it('não permite que GPS tardio altere a distância depois do lock de finalização', async () => {
        const { ride, captainId, startedAt } = createStartedRide({ finalizationState: 'finishing' });
        const result = await processRideTrackingPoint({
            rideId: ride._id,
            captainId,
            pointId: 'late',
            location: {
                ltd: B.lat,
                lng: B.lng,
                accuracy: 10,
                timestamp: startedAt.getTime() + 30 * 60 * 1000,
            },
        });

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('RIDE_NO_LONGER_TRACKABLE');
        expect(mockState.actualDistance).toBe(0);
    });
});
