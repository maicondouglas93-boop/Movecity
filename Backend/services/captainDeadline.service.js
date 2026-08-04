const cron = require('node-cron');
const captainModel = require('../models/captain.model');
const notificationService = require('./notification.service');
const { deleteByPrefix } = require('../cache/cache');

// Simplificação do cadastro do motorista (2026-08-04): prazo de 5 dias para envio da
// documentação (ver captain.service.js: DOCUMENT_DEADLINE_DAYS). O backend é a única
// fonte de verdade sobre a expiração — o frontend só exibe o que este cron já decidiu,
// nunca calcula por conta própria.
//
// Estados em que o prazo ainda está "em aberto" (o motorista pode expirar a partir
// daqui). 'aprovado'/'reprovado' já foram resolvidos por um admin — o prazo não se
// aplica mais. 'suspenso'/'bloqueado'/'expirado' são estados administrativos/terminais
// que este cron não deve sobrescrever.
const EXPIRABLE_STATUSES = ['iniciado', 'documentos_enviados', 'em_analise'];

// Dispara o lembrete quando falta 1 dia ou menos para o prazo — uma vez só por
// motorista (documentDeadlineReminderSent), para não reenviar a cada tick do cron.
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

// findOneAndUpdate com o status de origem no filtro (mesmo padrão de
// rideService.transitionRide): se dois ticks do cron colidirem (ou duas instâncias do
// backend rodando), só o primeiro "vence" cada motorista — o segundo recebe null e
// pula, sem notificação duplicada.
async function expireOverdueCaptains() {
    const now = new Date();
    // $ne: null é essencial aqui — na ordem de comparação do BSON, null é "menor" que
    // qualquer Date, então {$lt: now} sozinho combinaria com TODO motorista cadastrado
    // antes desta mudança (documentDeadline: null por padrão), expirando em massa quem
    // nunca teve prazo nenhum.
    const candidates = await captainModel.find({
        documentDeadline: { $ne: null, $lt: now },
        approvalStatus: { $in: EXPIRABLE_STATUSES }
    }).select('_id');

    let expiredCount = 0;
    for (const { _id } of candidates) {
        const updated = await captainModel.findOneAndUpdate(
            { _id, approvalStatus: { $in: EXPIRABLE_STATUSES } },
            { $set: { approvalStatus: 'expirado' } },
            { new: true }
        );
        if (!updated) continue;

        expiredCount++;
        deleteByPrefix(`profile:captain:${_id}`);
        notificationService.sendDocumentDeadlineExpired(_id, {}).catch(console.error);
    }

    return expiredCount;
}

async function sendDeadlineReminders() {
    const now = new Date();
    const soon = new Date(now.getTime() + REMINDER_WINDOW_MS);
    const candidates = await captainModel.find({
        documentDeadline: { $gte: now, $lte: soon },
        approvalStatus: { $in: EXPIRABLE_STATUSES },
        documentDeadlineReminderSent: false
    }).select('_id documentDeadline');

    let sentCount = 0;
    for (const captain of candidates) {
        const updated = await captainModel.findOneAndUpdate(
            { _id: captain._id, documentDeadlineReminderSent: false },
            { $set: { documentDeadlineReminderSent: true } },
            { new: true }
        );
        if (!updated) continue;

        sentCount++;
        notificationService.sendDocumentDeadlineReminder(captain._id, { documentDeadline: captain.documentDeadline }).catch(console.error);
    }

    return sentCount;
}

// Mesma cadência (a cada minuto) do cron de campanhas e do de tarifas agendadas já
// existentes no projeto.
cron.schedule('* * * * *', () => {
    expireOverdueCaptains().catch(err => console.error('[CaptainDeadline] Erro ao expirar prazos:', err));
    sendDeadlineReminders().catch(err => console.error('[CaptainDeadline] Erro ao enviar lembretes:', err));
});

module.exports = { expireOverdueCaptains, sendDeadlineReminders, EXPIRABLE_STATUSES };
