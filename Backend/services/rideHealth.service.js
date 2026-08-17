const cron = require('node-cron');
const rideModel = require('../models/ride.model');
const notificationService = require('./notification.service');

// Varredura de corridas que pararam de andar sozinhas.
//
// Antes disto, nenhum job olhava para corridas travadas: os defeitos de finalização
// corrigidos em 16-17/ago só apareceram porque um motorista reclamou. Uma corrida presa
// em `started` não fecha, não paga o motorista e não pode nem ser cancelada pelo fluxo
// normal (a máquina de estados não permite cancelar corrida iniciada) — mas ninguém
// ficava sabendo que ela existia.
//
// Este serviço apenas DETECTA e AVISA. Não cancela nem finaliza nada sozinho: agir
// automaticamente sobre dinheiro sem alguém olhando é justamente o tipo de decisão que
// não deve ser automatizada às cegas. O objetivo é você descobrir antes do cliente
// ligar.

// Uma corrida real dificilmente passa de 4h. Acima disso, ou o motorista esqueceu de
// finalizar, ou a finalização está falhando.
const STUCK_STARTED_HOURS = 4;

// finished_pending_payment / retry_required são estados de recuperação: normalmente
// duram segundos. Se persistem, a liquidação está falhando de verdade.
const STUCK_FINALIZATION_MINUTES = 30;

// A expiração de pedido sem motorista é preguiçosa (só roda quando o passageiro
// consulta a corrida atual). Sem ninguém consultando, o pedido fica no banco.
const STALE_REQUESTED_MINUTES = 30;

function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000);
}

/**
 * Procura corridas paradas em estados que deveriam ser passageiros.
 * Retorna os grupos encontrados, sem alterar nenhum documento.
 */
async function findStuckRides() {
    const [stuckStarted, stuckFinalization, staleRequested] = await Promise.all([
        rideModel.find({
            status: 'started',
            startedAt: { $lt: minutesAgo(STUCK_STARTED_HOURS * 60) },
        }).select('_id captain user startedAt finalizationState finalizationError').lean(),

        rideModel.find({
            status: 'finished',
            finalizationState: { $in: ['finished_pending_payment', 'retry_required'] },
            finishedAt: { $lt: minutesAgo(STUCK_FINALIZATION_MINUTES) },
        }).select('_id captain finalPrice paymentStatus finalizationState finalizationError finishedAt').lean(),

        rideModel.find({
            status: 'requested',
            createdAt: { $lt: minutesAgo(STALE_REQUESTED_MINUTES) },
        }).select('_id user createdAt').lean(),
    ]);

    return { stuckStarted, stuckFinalization, staleRequested };
}

async function reportStuckRides() {
    const groups = await findStuckRides();
    const total = groups.stuckStarted.length
        + groups.stuckFinalization.length
        + groups.staleRequested.length;

    if (total === 0) return { total, ...groups };

    // Log estruturado com os ids: é o que permite investigar sem precisar de query
    // manual no banco quando alguém relatar o problema.
    console.warn('[RideHealth] corridas travadas encontradas', {
        emAndamentoHaMuitoTempo: groups.stuckStarted.map((r) => String(r._id)),
        liquidacaoPendente: groups.stuckFinalization.map((r) => String(r._id)),
        pedidoSemMotorista: groups.staleRequested.map((r) => String(r._id)),
    });

    // Só a liquidação pendente vira alerta ativo: é a única que significa dinheiro não
    // creditado. As outras ficam no log — alertar sobre pedido sem motorista a cada
    // 15 min viraria ruído e o painel deixaria de ser lido.
    if (groups.stuckFinalization.length > 0) {
        const quantidade = groups.stuckFinalization.length;
        notificationService.sendAdminAlert(
            'Corridas com pagamento pendente',
            `${quantidade} corrida${quantidade > 1 ? 's' : ''} finalizada${quantidade > 1 ? 's' : ''} há mais de ${STUCK_FINALIZATION_MINUTES} min sem liquidar comissão.`,
            { type: 'ADMIN', category: 'FINANCE' }
        ).catch((err) => console.error('[RideHealth] alerta não enviado:', err.message));
    }

    return { total, ...groups };
}

// A cada 15 minutos: frequente o bastante para você descobrir no mesmo turno de
// trabalho, espaçado o bastante para não pesar no banco nem virar ruído.
if (process.env.NODE_ENV !== 'test') {
    cron.schedule('*/15 * * * *', () => {
        reportStuckRides().catch((err) => console.error('[RideHealth] erro na varredura:', err.message));
    });
}

module.exports = {
    STUCK_STARTED_HOURS,
    STUCK_FINALIZATION_MINUTES,
    STALE_REQUESTED_MINUTES,
    findStuckRides,
    reportStuckRides,
};
