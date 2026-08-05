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
require('../../models/wallet.model');
require('../../models/transaction.model');
require('../../models/globalSetting.model');

const parcelService = require('../../services/parcel.service');
const parcelModel = require('../../models/parcel.model');
const parcelSettingModel = require('../../models/parcelSetting.model');
const globalSettingModel = require('../../models/globalSetting.model');
const walletModel = require('../../models/wallet.model');
const transactionModel = require('../../models/transaction.model');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');

async function seedParcelReadyForPayment({ paymentMethod = 'cash' } = {}) {
    const user = await createUser({ email: `pay_user_${Date.now()}@test.com` });
    const captain = await createCaptain({ email: `pay_cap_${Date.now()}@test.com` });
    await walletModel.create({ captainId: captain._id, creditBalance: 100 });

    const { parcel } = await parcelService.createParcel({
        user: user._id,
        pickup: 'Rua A, 100 - Lajinha, MG',
        destination: 'Rua B, 200 - Lajinha, MG',
        vehicleType: 'moto',
        sender: { name: 'Remetente', phone: '33999999999' },
        recipient: { name: 'Destinatario', phone: '33888888888' },
        itemName: 'Documento',
        category: 'documento',
        weightKg: 1,
        size: 'small',
        paymentMethod,
    });

    await parcelModel.findByIdAndUpdate(parcel._id, {
        captain: captain._id,
        status: 'arrived_destination',
        $push: {
            statusHistory: { status: 'arrived_destination', at: new Date(), by: 'captain' },
        },
    });

    const withPin = await parcelModel.findById(parcel._id).select('+deliveryPin');
    const finished = await parcelService.confirmDelivery({
        parcelId: parcel._id,
        captain,
        pin: withPin.deliveryPin,
    });

    return { user, captain, parcel: finished };
}

describe('parcel payment (Decisão A)', () => {
    beforeAll(async () => {
        await mongoose.model('transaction').syncIndexes();
        await mongoose.model('parcel').syncIndexes();
    });

    beforeEach(async () => {
        await parcelModel.deleteMany({});
        await parcelSettingModel.deleteMany({});
        await globalSettingModel.deleteMany({});
        await walletModel.deleteMany({});
        await transactionModel.deleteMany({});
        await globalSettingModel.create({ platformCommission: 20 });
    });

    it('createParcel aceita só cash/pix e congela comissão', async () => {
        const user = await createUser({ email: `create_pay_${Date.now()}@test.com` });
        const { parcel } = await parcelService.createParcel({
            user: user._id,
            pickup: 'Rua A, 100',
            destination: 'Rua B, 200',
            vehicleType: 'moto',
            sender: { name: 'R', phone: '33999999999' },
            recipient: { name: 'D', phone: '33888888888' },
            itemName: 'Doc',
            category: 'documento',
            weightKg: 1,
            size: 'small',
            paymentMethod: 'pix',
        });

        expect(parcel.paymentMethod).toBe('pix');
        expect(parcel.paymentStatus).toBe('pending');
        expect(parcel.commissionPercent).toBe(20);
        expect(parcel.commissionAmount).toBeGreaterThan(0);
        expect(parcel.commissionAmount).toBe(
            Math.round(parcel.fare * 0.2 * 100) / 100
        );
    });

    it('createParcel rejeita card/carteira', async () => {
        const user = await createUser({ email: `bad_pay_${Date.now()}@test.com` });
        await expect(parcelService.createParcel({
            user: user._id,
            pickup: 'Rua A, 100',
            destination: 'Rua B, 200',
            vehicleType: 'moto',
            sender: { name: 'R', phone: '33999999999' },
            recipient: { name: 'D', phone: '33888888888' },
            itemName: 'Doc',
            category: 'documento',
            weightKg: 1,
            size: 'small',
            paymentMethod: 'card',
        })).rejects.toMatchObject({ message: 'INVALID_PAYMENT_METHOD' });
    });

    it('confirmDelivery deixa paymentStatus pending', async () => {
        const { parcel } = await seedParcelReadyForPayment();
        expect(parcel.status).toBe('finished');
        expect(parcel.paymentStatus).toBe('pending');
    });

    it('confirmParcelPayment debita comissão na wallet sem creditar o fare bruto', async () => {
        const { captain, parcel } = await seedParcelReadyForPayment({ paymentMethod: 'cash' });
        const before = await walletModel.findOne({ captainId: captain._id });

        const paid = await parcelService.confirmParcelPayment({
            parcelId: parcel._id,
            captain,
        });

        expect(paid.paymentStatus).toBe('paid');

        const after = await walletModel.findOne({ captainId: captain._id });
        expect(after.totalEarned).toBe(before.totalEarned + parcel.fare);
        expect(after.creditBalance).toBe(before.creditBalance - parcel.commissionAmount);
        expect(after.totalCommissionPaid).toBe(before.totalCommissionPaid + parcel.commissionAmount);

        const txs = await transactionModel.find({ parcelId: parcel._id }).sort({ type: 1 });
        expect(txs.map((t) => t.type).sort()).toEqual(['commission', 'parcel_payment']);
    });

    it('confirmParcelPayment é idempotente sob concorrência', async () => {
        const { captain, parcel } = await seedParcelReadyForPayment({ paymentMethod: 'pix' });

        const results = await Promise.allSettled([
            parcelService.confirmParcelPayment({ parcelId: parcel._id, captain }),
            parcelService.confirmParcelPayment({ parcelId: parcel._id, captain }),
        ]);

        const ok = results.filter((r) => r.status === 'fulfilled');
        const fail = results.filter((r) => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(fail).toHaveLength(1);
        expect(fail[0].reason.message).toBe('PAYMENT_ALREADY_CONFIRMED');

        const txs = await transactionModel.find({ parcelId: parcel._id });
        expect(txs.filter((t) => t.type === 'parcel_payment')).toHaveLength(1);
        expect(txs.filter((t) => t.type === 'commission')).toHaveLength(1);
    });

    // Regressão do E11000 { rideId:null, type:"commission" }: cada encomenda grava
    // comissão sem rideId; o índice parcial só pode indexar ObjectId real.
    it('duas encomendas liquidadas não colidem no índice rideId+type', async () => {
        const first = await seedParcelReadyForPayment({ paymentMethod: 'cash' });
        const second = await seedParcelReadyForPayment({ paymentMethod: 'cash' });

        await expect(parcelService.confirmParcelPayment({
            parcelId: first.parcel._id,
            captain: first.captain,
        })).resolves.toBeDefined();

        await expect(parcelService.confirmParcelPayment({
            parcelId: second.parcel._id,
            captain: second.captain,
        })).resolves.toBeDefined();

        const commissions = await transactionModel.find({ type: 'commission' });
        expect(commissions).toHaveLength(2);
        for (const tx of commissions) {
            expect(tx.rideId).toBeUndefined();
            expect(tx.parcelId).toBeDefined();
        }
    });

    it('getCurrentParcelForCaptain mantém unpaid finished até liquidar', async () => {
        const { captain, parcel } = await seedParcelReadyForPayment();
        const current = await parcelService.getCurrentParcelForCaptain(captain._id);
        expect(current._id.toString()).toBe(parcel._id.toString());
        expect(current.paymentStatus).toBe('pending');
    });
});
