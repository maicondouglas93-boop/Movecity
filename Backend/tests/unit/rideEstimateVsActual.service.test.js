const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const walletModel = require('../../models/wallet.model');
const transactionModel = require('../../models/transaction.model');
const VehicleCategory = require('../../models/vehicleCategory.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');

// Auditoria estimativa × valor final (2026-08-08): prova que endRide NUNCA usa
// simplesmente ride.fare (estimativa de X → Y) como finalPrice — sempre recalcula a
// partir de actualDistance/actualTime (o que realmente aconteceu), inclusive quando a
// corrida termina antes do destino pesquisado (X → Z, Z ≠ Y).
//
// Categoria: baseFare=10, perKm=2, perMinute=0.5, minimumFare=15, comissão=20%.
// Fórmula (PricingEngine.calculateFare, sem surcharges/adicionais nestes cenários):
//   subtotal = baseFare + (km × perKm) + (min × perMinute)
//   finalFare = max(subtotal, minimumFare)
async function seedCategory() {
    const pricing = {
        baseFare: 10,
        perKm: 2,
        perMinute: 0.5,
        minimumFare: 15,
        platformCommission: 20,
        parcelAdjustment: { isActive: false, type: 'percentage', value: 0 },
        optionals: [],
    };
    return VehicleCategory.create({
        name: 'car',
        displayName: 'Carro Econômico',
        isActive: true,
        baseFare: pricing.baseFare,
        perKmRate: pricing.perKm,
        perMinuteRate: pricing.perMinute,
        minFare: pricing.minimumFare,
        pricing,
    });
}

describe('Ride Service — estimativa × valor final (endRide)', () => {
    let user, captain;

    beforeEach(async () => {
        await seedCategory();
        user = await createUser();
        captain = await createCaptain();
    });

    // TESTE 1 — corrida termina no destino original (execução == estimativa)
    it('recalcula a partir de actualDistance/estimatedTime mesmo quando bate com a estimativa', async () => {
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5, // estimativa original: 10km/25min -> 10 + 20 + 12.5
            estimatedDistance: 10000,
            estimatedTime: 1500,
            actualDistance: 10000, // motorista percorreu exatamente os 10km pesquisados
            startedAt: new Date(),
        });

        const result = await rideService.endRide({ rideId: ride._id, captain });

        expect(result.finalPrice).toBe(42.5);
        expect(result.fare).toBe(42.5); // estimativa original preservada, não sobrescrita
    });

    // TESTE 2 — corrida termina ANTES do destino pesquisado (X -> Z, Z a 4km de X)
    it('cobra pelo trajeto real quando a corrida termina antes do destino pesquisado', async () => {
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5, // estimativa original: X -> Y, 10km/25min
            estimatedDistance: 10000,
            destination: 'Destino Y pesquisado',
            actualDistance: 4000, // só rodou 4km até Z
            estimatedTime: 600, // proxy de tempo real decorrido (10min) — ver nota abaixo
            startedAt: new Date(),
        });

        const result = await rideService.endRide({ rideId: ride._id, captain });

        // 10 + (4 * 2) + (10 * 0.5) = 23
        expect(result.finalPrice).toBe(23);
        expect(result.finalPrice).toBeLessThan(result.fare);
        expect(result.fare).toBe(42.5); // a estimativa de 10km NÃO é usada como cobrança
    });

    // TESTE 3 — corrida percorre distância MAIOR que a estimada (desvio/trânsito)
    it('cobra a mais quando a distância real excede a estimada', async () => {
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5, // estimativa original: 10km/25min
            estimatedDistance: 10000,
            actualDistance: 15000, // percorreu 15km de verdade
            estimatedTime: 2000, // ~33.3min reais
            startedAt: new Date(),
        });

        const result = await rideService.endRide({ rideId: ride._id, captain });

        // 10 + (15 * 2) + (2000/60 * 0.5) = 10 + 30 + 16.666... = 56.67
        expect(result.finalPrice).toBeCloseTo(56.67, 2);
        expect(result.finalPrice).toBeGreaterThan(result.fare);
    });

    // TESTE 4 — tarifa mínima: distância real pequena não pode gerar preço abaixo do mínimo
    it('nunca cobra abaixo da tarifa mínima mesmo com distância real pequena', async () => {
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5,
            estimatedDistance: 10000,
            actualDistance: 200, // 200m — bem menos que o pesquisado
            estimatedTime: 60,
            startedAt: new Date(),
        });

        const result = await rideService.endRide({ rideId: ride._id, captain });

        // 10 + 0.4 + 0.5 = 10.9 < minimumFare(15) -> piso de 15
        expect(result.finalPrice).toBe(15);
        expect(result.finalPrice).toBeGreaterThanOrEqual(15);
    });

    // TESTE 5 — comissão calculada sobre finalFare, não sobre a estimativa
    it('calcula a comissão sobre o valor final, não sobre a estimativa', async () => {
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5,
            estimatedDistance: 10000,
            actualDistance: 4000,
            estimatedTime: 600,
            startedAt: new Date(),
        });

        const result = await rideService.endRide({ rideId: ride._id, captain });

        expect(result.finalPrice).toBe(23);
        expect(result.commissionAmount).toBeCloseTo(4.6, 2); // 23 * 20%
        expect(result.commissionAmount).not.toBeCloseTo(42.5 * 0.2, 2); // nunca sobre a estimativa
    });

    // TESTE 6 — pagamento usa finalFare, não a estimativa
    it('confirmPaymentReceived registra o pagamento com o valor final, não a estimativa', async () => {
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5,
            estimatedDistance: 10000,
            actualDistance: 4000,
            estimatedTime: 600,
            startedAt: new Date(),
            paymentMethod: 'cash',
        });

        await rideService.endRide({ rideId: ride._id, captain });
        await rideService.confirmPaymentReceived({ rideId: ride._id, captain });

        const paymentTx = await transactionModel.findOne({ rideId: ride._id, type: 'ride_payment' });
        const commissionTx = await transactionModel.findOne({ rideId: ride._id, type: 'commission' });

        expect(paymentTx.amount).toBe(23); // finalPrice, não os 42.5 estimados
        expect(commissionTx.amount).toBeCloseTo(4.6, 2);
    });

    // TESTE 7 — carteira do motorista debitada com base no valor final
    it('debita a carteira do motorista com base na comissão do valor final', async () => {
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5,
            estimatedDistance: 10000,
            actualDistance: 4000,
            estimatedTime: 600,
            startedAt: new Date(),
            paymentMethod: 'cash',
        });

        await rideService.endRide({ rideId: ride._id, captain });
        await rideService.confirmPaymentReceived({ rideId: ride._id, captain });

        const wallet = await walletModel.findOne({ captainId: captain._id });

        // cash: ride_payment não mexe em creditBalance (dinheiro já ficou com o
        // motorista); só a comissão debita -4.6 (20% de 23, o valor FINAL real).
        expect(wallet.creditBalance).toBeCloseTo(-4.6, 2);
        expect(wallet.totalEarned).toBe(23);
    });

    // TESTE 8 — auditoria: estimativa original preservada quando o destino real difere
    it('preserva a estimativa original (X->Y) e registra separadamente onde a corrida terminou de fato (Z)', async () => {
        const searchedDestination = 'Avenida Y Pesquisada, 500';
        const searchedDestCoords = { lat: -23.55, lng: -46.63 }; // Y
        const actualFinishCoords = { lat: -23.56, lng: -46.64 }; // Z, diferente de Y

        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            fare: 42.5,
            estimatedDistance: 10000,
            destination: searchedDestination,
            destinationCoordinates: searchedDestCoords,
            actualDistance: 4000,
            estimatedTime: 600,
            startedAt: new Date(),
            lastLocation: { lat: actualFinishCoords.lat, lng: actualFinishCoords.lng },
        });

        const result = await rideService.endRide({ rideId: ride._id, captain });

        // Estimativa (o que foi PESQUISADO) continua intacta.
        expect(result.destination).toBe(searchedDestination);
        expect(result.destinationCoordinates.lat).toBe(searchedDestCoords.lat);
        expect(result.destinationCoordinates.lng).toBe(searchedDestCoords.lng);
        expect(result.estimatedDistance).toBe(10000);
        expect(result.fare).toBe(42.5);

        // Execução real (ONDE terminou de fato) registrada separadamente.
        expect(result.destinationMeta.source).toBe('gps_at_finish');
        expect(result.destinationMeta.coordinates).toEqual([actualFinishCoords.lng, actualFinishCoords.lat]);

        // Valor final diverge da estimativa — prova que não foi copiado.
        expect(result.finalPrice).not.toBe(result.fare);
    });
});
