const PricingEngine = require('../../services/pricingEngine.service');

describe('tarifa mínima como piso do subtotal completo', () => {
    const configSnapshot = {
        serviceKind: 'presential',
        globalSetting: {},
        globalTariffs: [],
        category: {
            name: 'car',
            pricing: {
                baseFare: 6,
                perKm: 0,
                perMinute: 0,
                minimumFare: 8,
                platformCommission: 10,
                optionals: [
                    { id: 'extra', name: 'Adicional', value: 2, isActive: true },
                ],
                surcharges: {
                    night: { active: false },
                    rain: { active: false },
                    waiting: { active: false },
                    extraStops: { active: false },
                },
            },
        },
    };

    it('não soma o adicional novamente depois de alcançar a tarifa mínima', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 0,
            time: 0,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'presential',
            optionals: { extra: true },
            configSnapshot,
        });

        expect(result.fareBreakdown.baseFare).toBe(6);
        expect(result.fareBreakdown.surcharges.optionals).toBe(2);
        expect(result.fareBreakdown.minimumFareAdjustment).toBe(0);
        expect(result.finalFare).toBe(8);
    });

    it('aplica somente a diferença necessária quando subtotal completo fica abaixo do mínimo', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 0,
            time: 0,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'presential',
            optionals: {},
            configSnapshot,
        });

        expect(result.fareBreakdown.minimumFareAdjustment).toBe(2);
        expect(result.finalFare).toBe(8);
    });

    it('inclui taxa de cartão no subtotal antes de aplicar o piso mínimo', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 0,
            time: 0,
            vehicleType: 'car',
            paymentMethod: 'card',
            serviceKind: 'presential',
            optionals: {},
            configSnapshot: {
                ...configSnapshot,
                globalSetting: { cardFeePercent: 10, cardFeeFixed: 0 },
            },
        });

        expect(result.fareBreakdown.cardFee).toBe(0.6);
        expect(result.fareBreakdown.minimumFareAdjustment).toBe(1.4);
        expect(result.finalFare).toBe(8);
    });
});
