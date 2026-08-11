const mongoose = require('mongoose');
const dispatchService = require('../../services/dispatch.service');
const adminService = require('../../services/admin.service');
const rideService = require('../../services/ride.service');
const Captain = require('../../models/captain.model');
const VehicleCategory = require('../../models/vehicleCategory.model');
const Ride = require('../../models/ride.model');
const { getAuthorizedVehicleTypesForCaptain } = require('../../services/vehicleAuthorization.service');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');

const candidate = (id, vehicleAuthorization, vehicleType = 'car') => ({
    _id: new mongoose.Types.ObjectId(id.padStart(24, '0')),
    vehicleAuthorization,
    vehicle: { vehicleType },
});

describe('Autorização de veículo do motorista', () => {
    it('aplica a matriz carro, moto e carro+moto no despacho', () => {
        const car = candidate('1', 'car');
        const motorcycle = candidate('2', 'motorcycle', 'moto');
        const both = candidate('3', 'car_motorcycle');
        const captains = [car, motorcycle, both];

        expect(dispatchService.filterCaptainsByVehicleType(captains, 'car', {
            category: { name: 'car', iconKey: 'car' },
        })).toEqual([car, both]);
        expect(dispatchService.filterCaptainsByVehicleType(captains, 'moto', {
            category: { name: 'moto', iconKey: 'moto' },
        })).toEqual([motorcycle, both]);
    });

    it('preserva o match estrito para categoria desconhecida', () => {
        const legacy = candidate('4', undefined, 'van_legacy');
        const car = candidate('5', 'car', 'car');
        expect(dispatchService.filterCaptainsByVehicleType([legacy, car], 'van_legacy')).toEqual([legacy]);
    });

    it('não deixa o fallback do veículo atual furar a autorização explícita', async () => {
        await Promise.all([
            VehicleCategory.create({ name: 'car', displayName: 'Carro', iconKey: 'car', isActive: true }),
            VehicleCategory.create({ name: 'moto', displayName: 'Moto', iconKey: 'moto', isActive: true }),
        ]);
        const types = await getAuthorizedVehicleTypesForCaptain({
            vehicleAuthorization: 'car',
            vehicle: { vehicleType: 'moto' },
        }, 'ride');
        expect(types).toEqual(['car']);
    });

    it('persiste todas as transições pelo CRUD administrativo existente', async () => {
        await VehicleCategory.create({ name: 'car', displayName: 'Carro', iconKey: 'car', isActive: true, capacity: 4 });
        const captain = await createCaptain({
            vehicleAuthorization: 'motorcycle',
            vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2024, color: 'Preto', plate: 'AUT1A11', capacity: 4, vehicleType: 'car' },
        });
        const admin = { _id: new mongoose.Types.ObjectId(), name: 'Admin Teste' };

        for (const vehicleAuthorization of ['car', 'car_motorcycle', 'motorcycle']) {
            await adminService.updateCaptainVehicle(captain._id, {
                marca: 'Fiat', modelo: 'Mobi', ano: 2024, color: 'Preto', plate: 'AUT1A11',
                vehicleType: 'car', vehicleAuthorization,
            }, admin, '127.0.0.1', 'Teste de autorização');
            const persisted = await Captain.findById(captain._id).lean();
            expect(persisted.vehicleAuthorization).toBe(vehicleAuthorization);
        }
    });

    it('bloqueia aceite direto de corrida incompatível no backend', async () => {
        await VehicleCategory.create({ name: 'car', displayName: 'Carro', iconKey: 'car', isActive: true });
        const [captain, user] = await Promise.all([
            createCaptain({ vehicleAuthorization: 'motorcycle' }),
            createUser(),
        ]);
        const ride = await Ride.create({
            user: user._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            fare: 20,
            vehicleType: 'car',
            status: 'requested',
        });

        await expect(rideService.acceptRideAtomic({ rideId: ride._id, captain }))
            .rejects.toThrow('VEHICLE_MISMATCH');
        const freshCaptain = await Captain.findById(captain._id).lean();
        expect(freshCaptain.busyLock).toBe(false);
    });
});
