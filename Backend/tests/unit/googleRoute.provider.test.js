const axios = require('axios');
const googleProvider = require('../../services/maps/google.provider');
const { deleteByPrefix } = require('../../cache/cache');

// Fase D da experiência de corrida ativa (2026-08-03): normalização da Routes API.
// Produção roda com MAPS_PROVIDER=google, então é este mapeamento que chega ao banner
// de manobras do motorista — e um erro aqui manda virar a esquina errada.
// axios é externalizado pelo Vitest (vem de node_modules); espionar a instância
// compartilhada é o que permite interceptar a chamada feita dentro do provider.

const ROUTES_RESPONSE = {
    data: {
        routes: [{
            duration: '900s',
            distanceMeters: 5400,
            polyline: {
                // GeoJSON é [lng, lat] — a normalização precisa inverter.
                geoJsonLinestring: { coordinates: [[-46.6333, -23.5505], [-46.6280, -23.5450]] }
            },
            legs: [{
                steps: [
                    {
                        distanceMeters: 1200,
                        navigationInstruction: { maneuver: 'DEPART', instructions: 'Siga para o norte na Av. Paulista' },
                        startLocation: { latLng: { latitude: -23.5505, longitude: -46.6333 } }
                    },
                    {
                        distanceMeters: 800,
                        navigationInstruction: { maneuver: 'TURN_LEFT', instructions: 'Vire à esquerda na Rua Augusta' },
                        startLocation: { latLng: { latitude: -23.5480, longitude: -46.6300 } }
                    },
                    {
                        distanceMeters: 0,
                        navigationInstruction: { maneuver: 'DESTINATION', instructions: 'O destino está à direita' },
                        startLocation: { latLng: { latitude: -23.5450, longitude: -46.6280 } }
                    }
                ]
            }]
        }]
    }
};

describe('google.provider.getRouteWithSteps (Fase D)', () => {
    let postSpy;

    beforeEach(() => {
        deleteByPrefix('google-route');
        deleteByPrefix('google-geocode');
        postSpy = jest.spyOn(axios, 'post').mockResolvedValue(ROUTES_RESPONSE);
    });

    afterEach(() => {
        postSpy.mockRestore();
    });

    it('normaliza polyline para [lat, lng] e traduz as manobras do Google', async () => {
        const route = await googleProvider.getRouteWithSteps('-23.550500,-46.633300', '-23.545000,-46.628000');

        expect(route.polyline[0]).toEqual([-23.5505, -46.6333]);
        expect(route.distance.value).toBe(5400);
        expect(route.duration.value).toBe(900);
        expect(route.steps.map(s => s.maneuver)).toEqual(['straight', 'turn-left', 'destination']);
        expect(route.steps[1].instruction).toBe('Vire à esquerda na Rua Augusta');
    });

    it('usa o INÍCIO do trecho como ponto da manobra (o fim adiantaria a conversão)', async () => {
        const route = await googleProvider.getRouteWithSteps('-23.550500,-46.633300', '-23.545000,-46.628000');

        expect(route.steps[1].location).toEqual({ lat: -23.5480, lng: -46.6300 });
    });

    it('pede as manobras no FieldMask e a resposta em pt-BR', async () => {
        await googleProvider.getRouteWithSteps('-23.550500,-46.633300', '-23.545000,-46.628000');

        const [, body, config] = postSpy.mock.calls[0];
        expect(body.languageCode).toBe('pt-BR');
        expect(config.headers['X-Goog-FieldMask']).toContain('routes.legs.steps.navigationInstruction');
        expect(config.headers['X-Goog-FieldMask']).toContain('routes.legs.steps.startLocation');
    });

    it('descarta passo sem coordenada em vez de emitir uma manobra com destino NaN', async () => {
        postSpy.mockResolvedValue({
            data: {
                routes: [{
                    duration: '60s',
                    distanceMeters: 100,
                    polyline: { geoJsonLinestring: { coordinates: [[-46.6333, -23.5505]] } },
                    legs: [{
                        steps: [
                            { distanceMeters: 100, navigationInstruction: { maneuver: 'TURN_RIGHT', instructions: 'Vire à direita' }, startLocation: {} },
                            { distanceMeters: 0, navigationInstruction: { maneuver: 'DESTINATION', instructions: 'Chegou' }, startLocation: { latLng: { latitude: -23.55, longitude: -46.63 } } }
                        ]
                    }]
                }]
            }
        });

        const route = await googleProvider.getRouteWithSteps('-23.550500,-46.633300', '-23.545000,-46.628000');

        expect(route.steps).toHaveLength(1);
        expect(route.steps[0].maneuver).toBe('destination');
    });

    it('propaga a falha em vez de inventar uma rota (quem decide o fallback é o serviço)', async () => {
        postSpy.mockRejectedValue(new Error('Routes API fora do ar'));

        await expect(
            googleProvider.getRouteWithSteps('-23.550500,-46.633300', '-23.545000,-46.628000')
        ).rejects.toThrow();
    });
});
