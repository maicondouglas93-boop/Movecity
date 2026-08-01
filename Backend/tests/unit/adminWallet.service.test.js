const adminService = require('../../services/admin.service');
const walletModel = require('../../models/wallet.model');
const captainModel = require('../../models/captain.model');
const globalSettingModel = require('../../models/globalSetting.model');
const mongoose = require('mongoose');

// Regression coverage for A1: adjustCaptainWallet costumava escrever em captain.earnings
// (contador de faturamento) em vez de wallet.creditBalance (saldo real da carteira),
// deixando o extrato do motorista aritmeticamente impossível e sem aplicar a regra de
// bloqueio por saldo negativo.
describe('Admin Service — adjustCaptainWallet', () => {
    let captainId;
    const fakeAdmin = { _id: new mongoose.Types.ObjectId(), name: 'Admin Teste', email: 'admin@test.com' };

    beforeEach(async () => {
        captainId = new mongoose.Types.ObjectId();
        await captainModel.create({
            _id: captainId,
            fullname: { firstname: 'Test', lastname: 'Driver' },
            email: 'driver@test.com',
            phone: '+5511999999999',
            password: 'password123',
            vehicle: { color: 'black', plate: 'TEST1234', capacity: 4, vehicleType: 'car' }
        });

        await globalSettingModel.create({
            platformCommission: 20,
            blockDriverOnNegativeBalance: true,
            maximumNegativeBalance: -20
        });
    });

    it('should credit wallet.creditBalance, not captain.earnings', async () => {
        const result = await adminService.adjustCaptainWallet(captainId, 100, 'credit', 'teste de crédito', fakeAdmin, '127.0.0.1');

        expect(result.balanceAfter).toBe(100);

        const wallet = await walletModel.findOne({ captainId });
        expect(wallet.creditBalance).toBe(100);

        const captain = await captainModel.findById(captainId);
        expect(captain.earnings || 0).toBe(0); // earnings não deve ser tocado por ajuste de carteira
    });

    it('should debit wallet.creditBalance correctly', async () => {
        await walletModel.create({ captainId, creditBalance: 50 });

        const result = await adminService.adjustCaptainWallet(captainId, 30, 'debit', 'teste de débito', fakeAdmin, '127.0.0.1');

        expect(result.balanceAfter).toBe(20);
        const wallet = await walletModel.findOne({ captainId });
        expect(wallet.creditBalance).toBe(20);
    });

    it('should block the driver when debit pushes balance below the negative threshold', async () => {
        await walletModel.create({ captainId, creditBalance: 0 });

        await adminService.adjustCaptainWallet(captainId, 30, 'debit', 'saldo negativo', fakeAdmin, '127.0.0.1');

        const captain = await captainModel.findById(captainId);
        expect(captain.canReceiveRides).toBe(false);
    });

    it('should record a transaction with a consistent ledger (balanceBefore/After match the wallet)', async () => {
        await walletModel.create({ captainId, creditBalance: 10 });

        const result = await adminService.adjustCaptainWallet(captainId, 15, 'credit', 'ajuste consistente', fakeAdmin, '127.0.0.1');

        expect(result.transaction.balanceBefore).toBe(10);
        expect(result.transaction.balanceAfter).toBe(25);
    });
});
