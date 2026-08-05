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

    const onlineMotoCaptain = (email, plate) => createCaptain({
        email,
        isOnline: true,
        location: { ltd: -20.1, lng: -41.6 },
        vehicle: { color: 'black', plate, capacity: 1, vehicleType: 'moto' },
    });

    it('acceptParcelAtomic é exclusivo — segundo captain falha', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const cap1 = await onlineMotoCaptain(`c1_${Date.now()}@test.com`, 'AAA1111');
        const cap2 = await onlineMotoCaptain(`c2_${Date.now()}@test.com`, 'BBB2222');

        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain: cap1 });
        await expect(
            parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain: cap2 })
        ).rejects.toThrow('PARCEL_ALREADY_ACCEPTED');
    });

    it('acceptParcelAtomic rejeita captain offline', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const cap = await createCaptain({
            email: `coff_${Date.now()}@test.com`,
            isOnline: false,
            location: { ltd: -20.1, lng: -41.6 },
            vehicle: { color: 'black', plate: 'OFF1111', capacity: 1, vehicleType: 'moto' },
        });
        await expect(
            parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain: cap })
        ).rejects.toThrow('CAPTAIN_NOT_ALLOWED');
    });

    it('toParcelOfferDTO não inclui telefones', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const dto = parcelService.toParcelOfferDTO(parcel);
        expect(dto.sender).toBeUndefined();
        expect(dto.recipient).toBeUndefined();
        expect(dto.deliveryPin).toBeUndefined();
        expect(dto.itemName).toBe('Documento');
    });

    it('expireStaleAwaitingParcels cancela awaiting antigo', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        await parcelModel.collection.updateOne(
            { _id: parcel._id },
            { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } }
        );
        await parcelService.expireStaleAwaitingParcels({ userId: parcel.user });
        const after = await parcelModel.findById(parcel._id);
        expect(after.status).toBe('cancelled');
        expect(after.cancellationReason).toBe('expired');
    });

    it('updateParcelStatus rejeita salto ilegal', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const captain = await onlineMotoCaptain(`c3_${Date.now()}@test.com`, 'CCC3333');
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
        const captain = await onlineMotoCaptain(`c4_${Date.now()}@test.com`, 'DDD4444');
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

    async function advanceTo(parcelId, captain, statuses) {
        for (const status of statuses) {
            await parcelService.updateParcelStatus({ parcelId, captain, status });
        }
    }

    it('concorrência: cancelar × avançar em arrived_pickup → exatamente 1 vence', async () => {
        const user = await createUser({ email: `race_u_${Date.now()}@test.com` });
        const { parcel } = await parcelService.createParcel(basePayload({ user: user._id }));
        const captain = await onlineMotoCaptain(`race_c_${Date.now()}@test.com`, 'RAC1111');
        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain });
        await advanceTo(parcel._id, captain, ['going_to_pickup', 'arrived_pickup']);

        const results = await Promise.allSettled([
            parcelService.cancelParcel({ parcelId: parcel._id, user: user._id, reason: 'desistiu' }),
            parcelService.updateParcelStatus({
                parcelId: parcel._id,
                captain,
                status: 'collected',
            }),
        ]);

        const wins = results.filter((r) => r.status === 'fulfilled');
        const losses = results.filter((r) => r.status === 'rejected');
        expect(wins).toHaveLength(1);
        expect(losses).toHaveLength(1);

        const after = await parcelModel.findById(parcel._id);
        expect(['cancelled', 'collected']).toContain(after.status);
        if (after.status === 'collected') {
            expect(after.cancelledBy).toBeFalsy();
        } else {
            expect(after.cancelledBy).toBe('passenger');
            expect(after.statusHistory.filter((h) => h.status === 'collected')).toHaveLength(0);
        }

        const cap = await captainModel.findById(captain._id);
        if (after.status === 'cancelled') {
            expect(cap.busyLock).toBe(false);
        } else {
            // Ainda em collected — motorista continua ocupado
            expect(cap.busyLock).toBe(true);
        }
    });

    it('concorrência: dois avanços idênticos → 1 vence', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const captain = await onlineMotoCaptain(`dup_c_${Date.now()}@test.com`, 'DUP1111');
        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain });

        const results = await Promise.allSettled([
            parcelService.updateParcelStatus({
                parcelId: parcel._id,
                captain,
                status: 'going_to_pickup',
            }),
            parcelService.updateParcelStatus({
                parcelId: parcel._id,
                captain,
                status: 'going_to_pickup',
            }),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

        const after = await parcelModel.findById(parcel._id);
        expect(after.status).toBe('going_to_pickup');
        expect(after.statusHistory.filter((h) => h.status === 'going_to_pickup')).toHaveLength(1);
    });

    it('concorrência: cancelar × aceitar → 1 vence', async () => {
        const user = await createUser({ email: `cxa_u_${Date.now()}@test.com` });
        const { parcel } = await parcelService.createParcel(basePayload({ user: user._id }));
        const captain = await onlineMotoCaptain(`cxa_c_${Date.now()}@test.com`, 'CXA1111');

        const results = await Promise.allSettled([
            parcelService.cancelParcel({ parcelId: parcel._id, user: user._id }),
            parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain }),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

        const after = await parcelModel.findById(parcel._id);
        expect(['cancelled', 'provider_accepted']).toContain(after.status);

        const cap = await captainModel.findById(captain._id);
        if (after.status === 'cancelled') {
            expect(cap.busyLock).toBe(false);
        }
    });

    it('cancelParcel após collected continua rejeitado', async () => {
        const user = await createUser({ email: `postc_u_${Date.now()}@test.com` });
        const { parcel } = await parcelService.createParcel(basePayload({ user: user._id }));
        const captain = await onlineMotoCaptain(`postc_c_${Date.now()}@test.com`, 'POC1111');
        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain });
        await advanceTo(parcel._id, captain, ['going_to_pickup', 'arrived_pickup', 'collected']);

        await expect(
            parcelService.cancelParcel({ parcelId: parcel._id, user: user._id })
        ).rejects.toThrow('PARCEL_NOT_CANCELLABLE');

        const after = await parcelModel.findById(parcel._id);
        expect(after.status).toBe('collected');
        expect(after.cancelledBy).toBeFalsy();
    });

    it('estado terminal finished não aceita transição posterior', async () => {
        const { parcel } = await parcelService.createParcel(basePayload());
        const captain = await onlineMotoCaptain(`term_c_${Date.now()}@test.com`, 'TRM1111');
        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain });
        await advanceTo(parcel._id, captain, [
            'going_to_pickup',
            'arrived_pickup',
            'collected',
            'in_transit',
            'arrived_destination',
        ]);
        const withPin = await parcelModel.findById(parcel._id).select('+deliveryPin');
        await parcelService.confirmDelivery({
            parcelId: parcel._id,
            captain,
            pin: withPin.deliveryPin,
        });

        await expect(
            parcelService.updateParcelStatus({
                parcelId: parcel._id,
                captain,
                status: 'in_transit',
            })
        ).rejects.toThrow('INVALID_STATUS_TRANSITION');

        await expect(
            parcelService.cancelParcel({
                parcelId: parcel._id,
                user: parcel.user,
            })
        ).rejects.toThrow('PARCEL_NOT_CANCELLABLE');
    });

    it('busyLock liberado apenas quando encomenda saiu do ar (cancel venceu)', async () => {
        const user = await createUser({ email: `lock_u_${Date.now()}@test.com` });
        const { parcel } = await parcelService.createParcel(basePayload({ user: user._id }));
        const captain = await onlineMotoCaptain(`lock_c_${Date.now()}@test.com`, 'LCK1111');
        await parcelService.acceptParcelAtomic({ parcelId: parcel._id, captain });

        let mid = await captainModel.findById(captain._id);
        expect(mid.busyLock).toBe(true);

        await parcelService.cancelParcel({ parcelId: parcel._id, user: user._id });
        mid = await captainModel.findById(captain._id);
        expect(mid.busyLock).toBe(false);
    });
});
