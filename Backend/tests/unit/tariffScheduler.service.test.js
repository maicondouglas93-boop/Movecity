const { applyDueSchedules } = require('../../services/tariffScheduler.service');
const tariffScheduleModel = require('../../models/tariffSchedule.model');
const tariffSettingModel = require('../../models/tariffSetting.model');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');

// Regression coverage for A10: "Agendar" no painel criava o documento tariffSchedule e
// nada mais — nenhum código nunca aplicava a mudança quando a data chegava.
describe('Tariff Scheduler Service — applyDueSchedules', () => {
    it('should apply a due category schedule and mark it as applied', async () => {
        const category = await vehicleCategoryModel.create({
            name: 'car', displayName: 'Carro', baseFare: 5, perKmRate: 1.5, perMinuteRate: 0.3, minFare: 8
        });

        await tariffScheduleModel.create({
            categoryId: category._id,
            scheduledFor: new Date(Date.now() - 60 * 1000), // já venceu
            changes: { baseFare: 10 },
            status: 'pending'
        });

        const applied = await applyDueSchedules();
        expect(applied).toBe(1);

        const updatedCategory = await vehicleCategoryModel.findById(category._id);
        expect(updatedCategory.baseFare).toBe(10);

        const schedule = await tariffScheduleModel.findOne({ categoryId: category._id });
        expect(schedule.status).toBe('applied');
    });

    it('should apply a due global schedule (categoryId null)', async () => {
        await tariffSettingModel.create({ cancellationFee: 5 });

        await tariffScheduleModel.create({
            categoryId: null,
            scheduledFor: new Date(Date.now() - 60 * 1000),
            changes: { cancellationFee: 12 },
            status: 'pending'
        });

        await applyDueSchedules();

        const tariffSetting = await tariffSettingModel.findOne();
        expect(tariffSetting.cancellationFee).toBe(12);
    });

    it('should NOT apply a schedule whose time has not come yet', async () => {
        const category = await vehicleCategoryModel.create({
            name: 'moto', displayName: 'Moto', baseFare: 5, perKmRate: 1.5, perMinuteRate: 0.3, minFare: 8
        });

        await tariffScheduleModel.create({
            categoryId: category._id,
            scheduledFor: new Date(Date.now() + 60 * 60 * 1000), // daqui a 1h
            changes: { baseFare: 99 },
            status: 'pending'
        });

        const applied = await applyDueSchedules();
        expect(applied).toBe(0);

        const unchangedCategory = await vehicleCategoryModel.findById(category._id);
        expect(unchangedCategory.baseFare).toBe(5);
    });

    it('should mark a schedule as failed when the target category no longer exists', async () => {
        const mongoose = require('mongoose');
        const ghostCategoryId = new mongoose.Types.ObjectId();

        await tariffScheduleModel.create({
            categoryId: ghostCategoryId,
            scheduledFor: new Date(Date.now() - 60 * 1000),
            changes: { baseFare: 10 },
            status: 'pending'
        });

        await applyDueSchedules();

        const schedule = await tariffScheduleModel.findOne({ categoryId: ghostCategoryId });
        expect(schedule.status).toBe('failed');
        expect(schedule.errorReason).toBeTruthy();
    });

    it('should not reapply a schedule already marked applied', async () => {
        const category = await vehicleCategoryModel.create({
            name: 'auto', displayName: 'Auto', baseFare: 5, perKmRate: 1.5, perMinuteRate: 0.3, minFare: 8
        });

        await tariffScheduleModel.create({
            categoryId: category._id,
            scheduledFor: new Date(Date.now() - 60 * 1000),
            changes: { baseFare: 999 },
            status: 'applied'
        });

        const applied = await applyDueSchedules();
        expect(applied).toBe(0);
    });
});
