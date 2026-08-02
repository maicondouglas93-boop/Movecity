// getCaptainsInTheRadius não chama nenhuma API externa — é uma query direta no Mongo
// (o mesmo banco em memória real dos testes). Só as funções acima (geocoding/distância/
// autocomplete) dependem do Google Maps de verdade e por isso continuam mockadas.
// Auditoria de UX do motorista (2026-08-02): esta função tinha ficado de fora deste mock
// desde sempre, e era a causa raiz da falha crônica de `POST /rides/create` na suíte
// (TypeError: mapService.getCaptainsInTheRadius is not a function) — os novos testes de
// captain-cancel também passam por ela via dispatchRideToCaptains, o que expôs a lacuna.
const { getCaptainsInTheRadius, haversineKm } = jest.requireActual('../maps.service');

module.exports = {
    getAddressCoordinate: jest.fn().mockResolvedValue({
        ltd: -23.550520,
        lng: -46.633308
    }),
    getDistanceTime: jest.fn().mockResolvedValue({
        distance: { text: '10 km', value: 10000 },
        duration: { text: '20 mins', value: 1200 }
    }),
    getAutoCompleteSuggestions: jest.fn().mockResolvedValue([
        { description: 'Avenida Paulista, São Paulo - SP, Brasil' },
        { description: 'Avenida Faria Lima, São Paulo - SP, Brasil' }
    ]),
    getCaptainsInTheRadius,
    haversineKm
};
