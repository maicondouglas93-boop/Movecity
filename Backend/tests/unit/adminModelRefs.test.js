const adminUserModel = require('../../models/adminUser.model');
const payoutModel = require('../../models/payout.model');
const auditLogModel = require('../../models/auditLog.model');
const tariffScheduleModel = require('../../models/tariffSchedule.model');
const accountDeletionRequestModel = require('../../models/accountDeletionRequest.model');
const notificationModel = require('../../models/notification.model');
const notificationCampaignModel = require('../../models/notificationCampaign.model');
const { createCaptain } = require('../factories/captain.factory');

// Auditoria pós-planejamento (2026-08-16, COR-plan Fase 1.1): os refs abaixo apontavam
// para 'adminUser'/'admin' (minúsculo) ou 'notificationCampaign' (minúsculo), mas os
// models estão registrados como 'AdminUser' e 'NotificationCampaign' — populate()
// lançava MissingSchemaError em produção. Este teste falha antes da correção e passa
// depois, cobrindo os 5 campos afetados.
describe('refs do Mongoose para AdminUser/NotificationCampaign', () => {
    let admin;
    let campaign;

    beforeEach(async () => {
        await Promise.all([
            adminUserModel.deleteMany({}),
            payoutModel.deleteMany({}),
            auditLogModel.deleteMany({}),
            tariffScheduleModel.deleteMany({}),
            accountDeletionRequestModel.deleteMany({}),
            notificationModel.deleteMany({}),
            notificationCampaignModel.deleteMany({}),
        ]);

        admin = await adminUserModel.create({
            name: 'Admin Teste',
            email: `admin_${Date.now()}@test.com`,
            password: 'hash',
        });

        campaign = await notificationCampaignModel.create({
            title: 'Campanha teste',
            message: 'Mensagem teste',
            targetRules: { audienceType: 'all' },
        });
    });

    it('popula payout.operatorId', async () => {
        const captain = await createCaptain();
        const payout = await payoutModel.create({
            captainId: captain._id,
            amount: 50,
            operatorId: admin._id,
        });

        const populated = await payoutModel.findById(payout._id).populate('operatorId');
        expect(populated.operatorId?.name).toBe('Admin Teste');
    });

    it('popula auditLog.admin', async () => {
        const log = await auditLogModel.create({
            action: 'UPDATE',
            entity: 'Tariff',
            admin: admin._id,
        });

        const populated = await auditLogModel.findById(log._id).populate('admin');
        expect(populated.admin?.name).toBe('Admin Teste');
    });

    it('popula tariffSchedule.createdBy', async () => {
        const schedule = await tariffScheduleModel.create({
            scheduledFor: new Date(),
            changes: { perKm: 3 },
            createdBy: admin._id,
        });

        const populated = await tariffScheduleModel.findById(schedule._id).populate('createdBy');
        expect(populated.createdBy?.name).toBe('Admin Teste');
    });

    it('popula accountDeletionRequest.verifiedBy', async () => {
        const request = await accountDeletionRequestModel.create({
            accountType: 'user',
            email: 'passageiro@test.com',
            source: 'authenticated',
            status: 'completed',
            verifiedBy: admin._id,
        });

        const populated = await accountDeletionRequestModel.findById(request._id).populate('verifiedBy');
        expect(populated.verifiedBy?.name).toBe('Admin Teste');
    });

    it('popula notification.campaignId', async () => {
        const notification = await notificationModel.create({
            title: 'Promoção',
            message: 'Aproveite',
            campaignId: campaign._id,
        });

        const populated = await notificationModel.findById(notification._id).populate('campaignId');
        expect(populated.campaignId?.title).toBe('Campanha teste');
    });
});
