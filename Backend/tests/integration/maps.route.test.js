const request = require('supertest');
const axios = require('axios');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { deleteByPrefix } = require('../../cache/cache');

// Fase D da experiência de corrida ativa (2026-08-03): GET /maps/get-route.
// Existe porque o LiveTracking chamava o OSRM público direto do navegador — sem cache,
// sem chave, fora do backend e, o que impedia a navegação, sem as manobras.
// Os testes usam o provider padrão dos testes ("osm", pois MAPS_PROVIDER não é
// definido no ambiente de teste) com o HTTP mockado: o que importa validar aqui é a
// NORMALIZAÇÃO da resposta do roteador, não a rede.

// O axios vem de node_modules e é externalizado pelo Vitest — `jest.mock` não o
// intercepta. Como o teste e os providers compartilham a MESMA instância (cache do
// require do Node), espionar o método aqui substitui a chamada lá dentro.
let getSpy;

const OSRM_RESPONSE = {
    data: {
        routes: [{
            distance: 2500.4,
            duration: 420.7,
            geometry: {
                // GeoJSON é [lng, lat]; a normalização precisa inverter.
                coordinates: [[-46.6333, -23.5505], [-46.6300, -23.5480], [-46.6280, -23.5450]]
            },
            legs: [{
                steps: [
                    {
                        distance: 1200,
                        name: 'Avenida Paulista',
                        maneuver: { type: 'depart', modifier: 'straight', location: [-46.6333, -23.5505] }
                    },
                    {
                        distance: 800,
                        name: 'Rua Augusta',
                        maneuver: { type: 'turn', modifier: 'left', location: [-46.6300, -23.5480] }
                    },
                    {
                        distance: 0,
                        name: '',
                        maneuver: { type: 'arrive', modifier: 'right', location: [-46.6280, -23.5450] }
                    }
                ]
            }]
        }]
    }
};

describe('GET /maps/get-route (Fase D)', () => {
    let userToken;

    beforeEach(async () => {
        getSpy = jest.spyOn(axios, 'get');
        // O serviço cacheia a rota por 5 min; sem limpar, o segundo teste leria o
        // resultado do primeiro em vez de exercitar a normalização de novo.
        deleteByPrefix('route-steps:');
        deleteByPrefix('route:');
        const user = await createUser();
        userToken = generateAuthToken(user);
    });

    afterEach(() => {
        getSpy.mockRestore();
    });

    it('devolve polyline em [lat, lng] e manobras normalizadas', async () => {
        getSpy.mockResolvedValue(OSRM_RESPONSE);

        const res = await request(app)
            .get('/maps/get-route')
            .query({ origin: '-23.550500,-46.633300', destination: '-23.545000,-46.628000' })
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.polyline[0]).toEqual([-23.5505, -46.6333]);
        expect(res.body.distance.value).toBe(2500);
        expect(res.body.duration.value).toBe(421);

        expect(res.body.steps).toHaveLength(3);
        expect(res.body.steps[1]).toMatchObject({
            maneuver: 'turn-left',
            distanceMeters: 800,
            location: { lat: -23.5480, lng: -46.6300 }
        });
        // O OSRM público não devolve texto de instrução — a frase é montada no provider.
        expect(res.body.steps[1].instruction).toContain('Rua Augusta');
        expect(res.body.steps[2].maneuver).toBe('destination');
    });

    it('o ponto de cada manobra é onde ela acontece, não o fim do trecho', async () => {
        getSpy.mockResolvedValue(OSRM_RESPONSE);

        const res = await request(app)
            .get('/maps/get-route')
            .query({ origin: '-23.550500,-46.633300', destination: '-23.545000,-46.628000' })
            .set('Authorization', `Bearer ${userToken}`);

        // Um deslocamento de um passo aqui faria o banner mandar virar uma esquina
        // adiantado — o erro mais perigoso de uma navegação.
        expect(res.body.steps[0].location).toEqual({ lat: -23.5505, lng: -46.6333 });
        expect(res.body.steps[2].location).toEqual({ lat: -23.5450, lng: -46.6280 });
    });

    it('degrada para rota sem manobras quando o roteador de passos falha', async () => {
        // getRouteWithSteps falha; o serviço cai em getDistanceTime, que tem o próprio
        // fallback. O mapa continua desenhando o traçado, só sem o banner de manobra.
        getSpy.mockRejectedValue(new Error('roteador fora do ar'));

        const res = await request(app)
            .get('/maps/get-route')
            .query({ origin: '-23.550500,-46.633300', destination: '-23.545000,-46.628000' })
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.steps).toEqual([]);
        expect(res.body.polyline.length).toBeGreaterThan(0);
        expect(res.body.distance.value).toBeGreaterThan(0);
    });

    it('exige autenticação', async () => {
        const res = await request(app)
            .get('/maps/get-route')
            .query({ origin: '-23.550500,-46.633300', destination: '-23.545000,-46.628000' });

        expect(res.status).toBe(401);
    });

    it('valida origem e destino', async () => {
        const res = await request(app)
            .get('/maps/get-route')
            .query({ origin: '-1', destination: '' })
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(400);
    });
});
