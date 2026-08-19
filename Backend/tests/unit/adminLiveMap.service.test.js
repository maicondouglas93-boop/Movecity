const { formatLiveMapDriver } = require('../../services/admin.service');

describe('formatLiveMapDriver', () => {
    it('marca disponível quando pode receber corridas e não está busy', () => {
        const driver = formatLiveMapDriver({
            _id: { toString: () => 'cap1' },
            fullname: { firstname: 'Ana', lastname: 'Silva' },
            location: { ltd: -23.5, lng: -46.6 },
            canReceiveRides: true,
            busyLock: false,
            vehicle: { plate: 'ABC1D23', vehicleType: 'car', color: 'preto', modelo: 'Onix' },
            lastSeenAt: new Date('2026-08-05T12:00:00.000Z'),
        });

        expect(driver.captainId).toBe('cap1');
        expect(driver.name).toBe('Ana Silva');
        expect(driver.status).toBe('available');
        expect(driver.vehicle.plate).toBe('ABC1D23');
        expect(driver.ltd).toBe(-23.5);
        expect(driver.lng).toBe(-46.6);
    });

    it('marca in_ride quando canReceiveRides é false ou busyLock', () => {
        const byFlag = formatLiveMapDriver({
            _id: { toString: () => 'cap2' },
            fullname: { firstname: 'Bia' },
            location: { ltd: 1, lng: 2 },
            canReceiveRides: false,
            busyLock: false,
            vehicle: {},
        });
        expect(byFlag.status).toBe('in_ride');
        expect(byFlag.name).toBe('Bia');

        const byLock = formatLiveMapDriver({
            _id: { toString: () => 'cap3' },
            fullname: {},
            location: { ltd: 1, lng: 2 },
            canReceiveRides: true,
            busyLock: true,
            vehicle: {},
        });
        expect(byLock.status).toBe('in_ride');
        expect(byLock.name).toBe('Motorista');
    });
});

const adminService = require('../../services/admin.service');
const captainModel = require('../../models/captain.model');
const rideModel = require('../../models/ride.model');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');
const { createRide } = require('../factories/ride.factory');

/**
 * Relato de campo (2026-08-19): corrida "EM VIAGEM" há mais de uma hora e o motorista
 * não aparecia no mapa do painel — o mapa abria centrado no fallback, como se não
 * houvesse frota nenhuma.
 *
 * Causa: getLiveMapCaptains montava a consulta a partir do availabilityFilter, que
 * responde "dá pra DESPACHAR pra este motorista?" e exige batimento (lastSeenAt) dentro
 * de 15 min. Quem perde sinal no meio da viagem para de bater e caía do mapa justamente
 * com passageiro embarcado.
 */
describe('getLiveMapCaptains — motorista em serviço não some do mapa', () => {
    const LAJINHA = { ltd: -20.1382, lng: -41.6069 };
    const UMA_HORA_ATRAS = () => new Date(Date.now() - 60 * 60 * 1000);

    it('mostra motorista em viagem mesmo sem batimento recente', async () => {
        const user = await createUser();
        const captain = await createCaptain({
            location: LAJINHA,
            lastSeenAt: UMA_HORA_ATRAS(),
            isOnline: false, // app morto pelo Android durante a viagem
        });
        await createRide({ user: user._id, captain: captain._id, status: 'started' });

        const { drivers, counts } = await adminService.getLiveMapCaptains();

        const encontrado = drivers.find((d) => d.captainId === captain._id.toString());
        expect(encontrado).toBeTruthy();
        expect(encontrado.status).toBe('in_ride');
        expect(encontrado.ltd).toBeCloseTo(LAJINHA.ltd, 4);
        // A posição é antiga e o painel precisa poder dizer isso, em vez de fingir
        // que o motorista está ali agora.
        expect(encontrado.isStale).toBe(true);
        expect(encontrado.minutesSinceLastSeen).toBeGreaterThanOrEqual(59);
        expect(counts.stale).toBeGreaterThanOrEqual(1);
    });

    it('não ressuscita motorista sem serviço ativo e sem batimento', async () => {
        await createCaptain({
            location: LAJINHA,
            lastSeenAt: UMA_HORA_ATRAS(),
            isOnline: true,
        });

        const { drivers } = await adminService.getLiveMapCaptains();

        expect(drivers).toHaveLength(0);
    });

    it('conta o motorista em serviço que nunca mandou posição, em vez de omiti-lo', async () => {
        const user = await createUser();
        const captain = await createCaptain({ lastSeenAt: UMA_HORA_ATRAS(), isOnline: false });
        await captainModel.updateOne({ _id: captain._id }, { $unset: { location: '' } });
        await createRide({ user: user._id, captain: captain._id, status: 'started' });

        const { drivers, counts } = await adminService.getLiveMapCaptains();

        expect(drivers).toHaveLength(0);
        expect(counts.inServiceWithoutPosition).toBe(1);
    });

    it('segue mostrando motorista disponível com batimento recente', async () => {
        const captain = await createCaptain({ location: LAJINHA, lastSeenAt: new Date(), isOnline: true });

        const { drivers } = await adminService.getLiveMapCaptains();

        const encontrado = drivers.find((d) => d.captainId === captain._id.toString());
        expect(encontrado.status).toBe('available');
        expect(encontrado.isStale).toBe(false);
    });

    afterEach(async () => {
        await rideModel.deleteMany({});
        await captainModel.deleteMany({});
    });
});
