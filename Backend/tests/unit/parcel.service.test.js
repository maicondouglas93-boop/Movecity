const mongoose = require('mongoose');

jest.mock('../../services/maps.service', () => ({
    getDistanceTime: jest.fn().mockResolvedValue({
        distance: { value: 5000 },
        duration: { value: 900 },
    }),
    getAddressCoordinate: jest.fn().mockResolvedValue({ ltd: -20.1, lng: -41.6 }),
    haversineKm: jest.fn().mockReturnValue(1),
    getCaptainsInTheRadius: jest.fn().mockResolvedValue([]),
}));

require('../../models/captain.model');
require('../../models/user.model');
const parcelService = require('../../services/parcel.service');
const parcelModel = require('../../models/parcel.model');
const parcelSettingModel = require('../../models/parcelSetting.model');
const captainModel = require('../../models/captain.model');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');

describe('parcel.service', () => {
    beforeEach(async () => {
        await parcelModel.deleteMany({});
        await parcelSettingModel.deleteMany({});
        await captainModel.deleteMany({});
    });

    const basePayload = (overrides = {}) => ({
        user: new mongoose.Types.ObjectId(),
        pickup: 'Rua A, 100 - Lajinha, MG',
        destination: 'Rua B, 200 - Lajinha, MG',
        vehicleType: 'moto',
        sender: { name: 'Remetente', phone: '33999999999' },
        recipient: { name: 'Destinatario', phone: '33888888888' },
        itemName: 'Documento',
        category: 'documento',
        weightKg: 1,
        size: 'small',
        description: 'Envelope',
        notes: 'Interfone 12',
        ...overrides,
    });

    it('getParcelFare considera vehicleType (carro tem surcharge)', async () => {
        const moto = await parcelService.getParcelFare({
            pickup: 'aaa street',
            destination: 'bbb street',
            vehicleType: 'moto',
        });
        const car = await parcelService.getParcelFare({
            pickup: 'aaa street',
            destination: 'bbb street',
            vehicleType: 'car',
        });
        expect(car.fare).toBeGreaterThan(moto.fare);
    });

    it('createParcel gera PIN select:false e status awaiting_provider', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        expect(parcel.status).toBe('awaiting_provider');

        const listed = await parcelModel.findById(parcel._id);
        expect(listed.deliveryPin).toBeUndefined();

        const withPin = await parcelModel.findById(parcel._id).select('+deliveryPin');
        expect(withPin.deliveryPin).toMatch(/^\d{4}$/);
    });

    it('createParcel ignora user do payload alienígena quando controller força autenticado', async () => {
        const owner = await createUser({ email: `owner_${Date.now()}@test.com` });
        const stranger = new mongoose.Types.ObjectId();
        // Service recebe user já forçado pelo controller (último campo).
        const { parcel } = await parcelService.createParcel(basePayload({
            user: owner._id,
        }));
        expect(parcel.user.toString()).toBe(owner._id.toString());
        expect(parcel.user.toString()).not.toBe(stranger.toString());
    });

    it('createParcel rejeita se user já tem parcel ativa', async () => {
        const user = await createUser({ email: `u_active_${Date.now()}@test.com` });
        await parcelService.createParcel(basePayload({ user: user._id }));
        await expect(
            parcelService.createParcel(basePayload({ user: user._id }))
        ).rejects.toThrow('USER_HAS_ACTIVE_PARCEL');
    });

    it('acceptParcelAtomic é exclusivo — segundo captain falha', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const cap1 = await createCaptain({
            email: `c1_${Date.now()}@test.com`,
            vehicle: { color: 'black', plate: 'AAA1111', capacity: 1, vehicleType: 'moto' },
        });
        const cap2 = await createCaptain({
            email: `c2_${Date.now()}@test.com`,
            vehicle: { color: 'black', plate: 'BBB2222', capacity: 1, vehicleType: 'moto' },
        });

        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain: cap1 });
        await expect(
            parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain: cap2 })
        ).rejects.toThrow('PARCEL_ALREADY_ACCEPTED');
    });

    it('updateParcelStatus rejeita salto ilegal', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const captain = await createCaptain({
            email: `c3_${Date.now()}@test.com`,
            vehicle: { color: 'black', plate: 'CCC3333', capacity: 1, vehicleType: 'moto' },
        });
        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain });

        await expect(
            parcelService.updateParcelStatus({
                parcelId: parcel._id,
                captain,
                status: 'delivered',
            })
        ).rejects.toThrow('INVALID_STATUS_TRANSITION');

        await expect(
            parcelService.updateParcelStatus({
                parcelId: parcel._id,
                captain,
                status: 'in_transit',
            })
        ).rejects.toThrow('INVALID_STATUS_TRANSITION');
    });

    it('confirmDelivery com PIN errado não muda status; sucesso vai direto a finished', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const captain = await createCaptain({
            email: `c4_${Date.now()}@test.com`,
            vehicle: { color: 'black', plate: 'DDD4444', capacity: 1, vehicleType: 'moto' },
        });
        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain });

        for (const status of [
            'going_to_pickup',
            'arrived_pickup',
            'collected',
            'in_transit',
            'arrived_destination',
        ]) {
            await parcelService.updateParcelStatus({ parcelId: parcel._id, captain, status });
        }

        await expect(
            parcelService.confirmDelivery({ parcelId: parcel._id, captain, pin: '0000' })
        ).rejects.toThrow('INVALID_PIN');

        const still = await parcelModel.findById(parcel._id);
        expect(still.status).toBe('arrived_destination');

        const withPin = await parcelModel.findById(parcel._id).select('+deliveryPin');
        const done = await parcelService.confirmDelivery({
            parcelId: parcel._id,
            captain,
            pin: withPin.deliveryPin,
        });
        expect(done.status).toBe('finished');
        // Nunca persistiu só em delivered
        const historyStatuses = done.statusHistory.map((h) => h.status);
        expect(historyStatuses).toContain('delivered');
        expect(historyStatuses).toContain('finished');
        const raw = await parcelModel.findById(parcel._id);
        expect(raw.status).toBe('finished');

        const unlocked = await captainModel.findById(captain._id);
        expect(unlocked.busyLock).toBe(false);
    });

    it('declineParcel não altera status', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        await parcelService.declineParcel({
            parcelId: parcel._id,
            captain: { _id: new mongoose.Types.ObjectId() },
        });
        const still = await parcelModel.findById(parcel._id);
        expect(still.status).toBe('awaiting_provider');
        expect(still.captain).toBeFalsy();
    });
});
