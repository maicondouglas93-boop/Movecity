jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.requireActual('../../services/maps/geo.util').haversineKm,
    getDistanceTime: jest.fn(),
    getAddressCoordinate: jest.fn(),
    getReverseGeocode: jest.fn(),
}));

const { __testing__ } = require('../../services/ride.service');

/**
 * Escolha do ponto de partida de uma corrida presencial.
 *
 * Relato de campo (2026-08-18): toda corrida presencial falhava, no celular e no PC.
 * A checagem anti-teleporte descartava o GPS real de quem tivesse andado mais de 2 km
 * desde o último contato do servidor e usava a posição ANTIGA como origem — sem olhar
 * quando ela havia sido gravada. Uma posição de horas atrás virava a partida da
 * corrida, produzindo rotas absurdas.
 *
 * A trava contra GPS falsificado continua: ela só vale enquanto o servidor realmente
 * sabe onde o motorista está.
 */
describe('origem da corrida presencial', () => {
    const LAJINHA = { ltd: -20.1506791, lng: -41.6191228 };
    const AGORA = new Date('2026-08-18T12:00:00Z').getTime();
    const minutosAtras = (m) => new Date(AGORA - m * 60 * 1000);

    // ~5 km ao norte: mais que o limite de 2 km da checagem de salto.
    const GPS_LONGE = { lat: -20.1056791, lng: -41.6191228 };
    const GPS_PERTO = { lat: -20.1516791, lng: -41.6191228 };

    const captain = (lastSeenAt) => ({ location: LAJINHA, lastSeenAt });

    it('usa o GPS atual quando a posição do servidor está velha', () => {
        const origin = __testing__.resolveCaptainOrigin(
            captain(minutosAtras(60)), GPS_LONGE.lat, GPS_LONGE.lng, AGORA
        );

        expect(origin).toMatchObject({ lat: GPS_LONGE.lat, lng: GPS_LONGE.lng });
    });

    it('mantém a trava anti-teleporte enquanto a posição do servidor é recente', () => {
        const origin = __testing__.resolveCaptainOrigin(
            captain(minutosAtras(1)), GPS_LONGE.lat, GPS_LONGE.lng, AGORA
        );

        expect(origin).toMatchObject({ lat: LAJINHA.ltd, lng: LAJINHA.lng, from: 'server' });
    });

    it('aceita GPS coerente com a posição recente do servidor', () => {
        const origin = __testing__.resolveCaptainOrigin(
            captain(minutosAtras(1)), GPS_PERTO.lat, GPS_PERTO.lng, AGORA
        );

        expect(origin).toMatchObject({ lat: GPS_PERTO.lat, lng: GPS_PERTO.lng });
    });

    it('sem lastSeenAt, trata a posição guardada como velha', () => {
        const origin = __testing__.resolveCaptainOrigin(
            captain(null), GPS_LONGE.lat, GPS_LONGE.lng, AGORA
        );

        expect(origin).toMatchObject({ lat: GPS_LONGE.lat, lng: GPS_LONGE.lng });
    });

    it('sem GPS do app, continua usando a posição do servidor', () => {
        const origin = __testing__.resolveCaptainOrigin(captain(minutosAtras(60)), null, null, AGORA);

        expect(origin).toMatchObject({ lat: LAJINHA.ltd, lng: LAJINHA.lng, from: 'server' });
    });

    it('sem nenhuma posição utilizável, não inventa origem', () => {
        expect(__testing__.resolveCaptainOrigin({}, null, null, AGORA)).toBeNull();
        // (0,0) é ausência de GPS, não um ponto no golfo da Guiné.
        expect(__testing__.resolveCaptainOrigin({ location: { ltd: 0, lng: 0 } }, 0, 0, AGORA)).toBeNull();
    });
});
