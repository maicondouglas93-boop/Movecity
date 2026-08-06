const { approximateRouteFromCoords } = require('../../services/maps/geo.util');
const googleProvider = require('../../services/maps/google.provider');
const osmProvider = require('../../services/maps/osm.provider');
const axios = require('axios');
const { deleteByPrefix } = require('../../cache/cache');

describe('maps — não inventar coordenadas nem rota fixa', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        deleteByPrefix('google-geocode');
        deleteByPrefix('google-route');
        deleteByPrefix('route:');
        deleteByPrefix('geocode:');
    });

    it('approximateRouteFromCoords usa haversine real, não 15.2 km inventados', () => {
        const route = approximateRouteFromCoords(
            { ltd: -23.5505, lng: -46.6333 },
            { ltd: -23.5450, lng: -46.6280 }
        );
        expect(route.distance.value).toBeGreaterThan(0);
        expect(route.distance.value).not.toBe(15200);
        expect(route.polyline).toHaveLength(2);
    });

    it('google.getAddressCoordinate propaga falha em vez de inventar SP', async () => {
        const prev = process.env.GOOGLE_MAPS_API;
        process.env.GOOGLE_MAPS_API = 'test-key';
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('network down'));

        await expect(
            googleProvider.getAddressCoordinate('Rua que não existe, Cidade X')
        ).rejects.toThrow(/Unable to fetch coordinates/);

        process.env.GOOGLE_MAPS_API = prev;
    });

    it('osm.getDistanceTime usa haversine quando roteadores falham (coords embutidas)', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('routers down'));

        const route = await osmProvider.getDistanceTime(
            '-23.550500,-46.633300',
            '-23.545000,-46.628000'
        );

        expect(route.distance.value).toBeGreaterThan(0);
        expect(route.distance.value).not.toBe(15200);
        expect(route.polyline.length).toBeGreaterThanOrEqual(2);
    });
});
