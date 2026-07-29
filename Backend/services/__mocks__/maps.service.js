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
    ])
};
