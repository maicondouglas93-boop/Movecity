const cron = require('node-cron');
const tariffScheduleModel = require('../models/tariffSchedule.model');
const tariffSettingModel = require('../models/tariffSetting.model');
const vehicleCategoryModel = require('../models/vehicleCategory.model');

// Aplica agendamentos de tarifa cujo scheduledFor já passou. Antes, o botão "Agendar"
// no painel só criava o documento tariffSchedule no banco — nenhum código nunca o lia
// de volta, então a tarifa "agendada" nunca entrava em vigor sozinha (A10 na auditoria).
async function applyDueSchedules() {
    const dueSchedules = await tariffScheduleModel.find({
        status: 'pending',
        scheduledFor: { $lte: new Date() }
    });

    for (const schedule of dueSchedules) {
        try {
            if (schedule.categoryId) {
                const category = await vehicleCategoryModel.findById(schedule.categoryId);
                if (!category) {
                    throw new Error('Categoria não encontrada (pode ter sido removida)');
                }
                Object.assign(category, schedule.changes);
                await category.save();
            } else {
                let tariffSetting = await tariffSettingModel.findOne();
                if (!tariffSetting) {
                    tariffSetting = await tariffSettingModel.create({});
                }
                Object.assign(tariffSetting, schedule.changes);
                await tariffSetting.save();
            }

            schedule.status = 'applied';
            await schedule.save();
        } catch (err) {
            schedule.status = 'failed';
            schedule.errorReason = err.message;
            await schedule.save();
            console.error(`[TariffScheduler] Falha ao aplicar agendamento ${schedule._id}:`, err.message);
        }
    }

    return dueSchedules.length;
}

// Roda a cada minuto — mesma cadência do cron de campanhas de notificação já existente
// em notification.service.js.
cron.schedule('* * * * *', () => {
    applyDueSchedules().catch(err => console.error('[TariffScheduler] Erro no cron:', err));
});

module.exports = { applyDueSchedules };
