const mapService = require('../../services/maps.service');
const adminMapsController = require('../../controllers/adminMaps.controller');

function mockRes() {
    const res = {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        set(key, value) {
            this.headers[key] = value;
            return this;
        },
    };
    return res;
}

describe('adminMaps.controller', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('estimateRoute devolve km/min e polyline a partir do maps.service', async () => {
        jest.spyOn(mapService, 'getDistanceTime').mockResolvedValue({
            distance: { text: '5.0 km', value: 5000 },
            duration: { text: '12 mins', value: 720 },
            polyline: [[-23.55, -46.63], [-23.54, -46.62]],
        });

        const req = {
            body: {
                pickup: 'Origem (-23.55, -46.63)',
                destination: 'Destino (-23.54, -46.62)',
            },
        };
        const res = mockRes();

        await adminMapsController.estimateRoute(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.distanceKm).toBe(5);
        expect(res.body.durationMin).toBe(12);
        expect(res.body.distanceMeters).toBe(5000);
        expect(res.body.polyline).toHaveLength(2);
    });

    it('getSuggestions exige input válido e devolve array', async () => {
        jest.spyOn(mapService, 'getAutoCompleteSuggestionsWithSession').mockResolvedValue({
            suggestions: [{ title: 'Av. Paulista', lat: -23.56, lng: -46.65 }],
            sessionToken: 'tok-1',
        });

        const req = { query: { input: 'Paulista' } };
        const res = mockRes();

        await adminMapsController.getSuggestions(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body[0].title).toBe('Av. Paulista');
        expect(res.headers['X-Maps-Session-Token']).toBe('tok-1');
    });
});
