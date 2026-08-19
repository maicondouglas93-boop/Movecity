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

// Lembrete ao motorista, muito antes do alerta de 4h. Uma corrida em Lajinha raramente
// passa de ~50 min; acima disso a explicação mais provável não é uma viagem longa, e sim
// o motorista ter saído do app (ou o Android ter matado) sem finalizar. Avisar cedo
// resolve sozinho o caso comum — e evita que a corrida só apareça quando já está travada.
const LONG_RIDE_REMINDER_MINUTES = Number(process.env.LONG_RIDE_REMINDER_MINUTES) || 60;

// Corrida contratada por tempo ("motorista à disposição") é longa POR DEFINIÇÃO. Mandar
// esse lembrete nela seria cutucar quem está fazendo exatamente o combinado.
const TIME_HIRE_OPTIONAL = 'disposicao_passageiro';

// Presencial parada antes do PIN.
//
// Ela nasce em `accepted` e só vira `started` quando o motorista digita o PIN. Entre um e
// outro existe uma conversa real com o passageiro — que pode desistir. Se o motorista
// fecha o app nesse ponto, a corrida fica em `accepted` com o busyLock ativo: ele para de
// receber oferta e nada na tela diz por quê. Era o único estado travado do sistema sobre
// o qual ninguém era avisado (achado P2 da auditoria do presencial, 2026-08-19).
//
// 15 min: o PIN é coisa de segundos. Acima disso já não é conversa, é corrida esquecida.
const PRESENTIAL_AWAITING_PIN_MINUTES = Number(process.env.PRESENTIAL_AWAITING_PIN_MINUTES) || 15;

function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000);
}

/**
 * Procura corridas paradas em estados que deveriam ser passageiros.
 * Retorna os grupos encontrados, sem alterar nenhum documento.
 */
async function findStuckRides() {
    const [stuckStarted, stuckFinalization, staleRequested, presentialAwaitingPin] = await Promise.all([
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

        // Presencial parada antes do PIN: o motorista segue ocupado (busyLock) sem estar
        // rodando nada. Entra no relatório para o operador enxergar, além do lembrete que
        // vai direto pra ele.
        rideModel.find({
            status: 'accepted',
            source: 'driver_initiated',
            createdAt: { $lt: minutesAgo(PRESENTIAL_AWAITING_PIN_MINUTES) },
        }).select('_id captain createdAt').lean(),
    ]);

    return { stuckStarted, stuckFinalization, staleRequested, presentialAwaitingPin };
}

/**
 * Avisa o motorista de corrida aberta há tempo demais.
 *
 * A marcação de `longRideReminderAt` é feita por findOneAndUpdate condicional, ANTES de
 * enviar: é o que garante um aviso só. A varredura roda a cada 15 min e pode haver mais
 * de uma instância do servidor — sem o claim atômico, o motorista receberia o mesmo
 * empurrão várias vezes e pararia de ler qualquer notificação nossa.
 */
async function remindLongRunningRides() {
    const candidatas = await rideModel.find({
        status: 'started',
        startedAt: { $lt: minutesAgo(LONG_RIDE_REMINDER_MINUTES) },
        longRideReminderAt: null,
        captain: { $ne: null },
        // Nenhum item "à disposição" na corrida (optionals é array de subdocumentos, e
        // este $ne casa com "nenhum elemento tem esse type").
        'optionals.type': { $ne: TIME_HIRE_OPTIONAL },
    }).select('_id captain startedAt').lean();

    const avisadas = [];
    for (const ride of candidatas) {
        // eslint-disable-next-line no-await-in-loop
        const claimed = await rideModel.findOneAndUpdate(
            { _id: ride._id, status: 'started', longRideReminderAt: null },
            { $set: { longRideReminderAt: new Date() } },
            { new: true, projection: { _id: 1 } }
        );
        if (!claimed) continue;

        const minutesRunning = Math.round((Date.now() - new Date(ride.startedAt).getTime()) / 60000);
        try {
            // eslint-disable-next-line no-await-in-loop
            await notificationService.sendLongRideReminder(String(ride.captain), {
                rideId: String(ride._id),
                referenceId: String(ride._id),
                minutesRunning,
            });
            avisadas.push(String(ride._id));
        } catch (err) {
            // O envio falhou, mas a corrida já está marcada. Melhor perder UM lembrete do
            // que arriscar repetir: quem não finalizar continua sendo pego pelo alerta de
            // 4h, que é a rede de segurança de verdade.
            console.error('[RideHealth] lembrete de corrida longa não enviado:', String(ride._id), err.message);
        }
    }

    return avisadas;
}

/**
 * Avisa o motorista de presencial parada esperando o PIN.
 *
 * Mesma trava de repetição do lembrete de corrida longa, e pelo mesmo motivo: a varredura
 * roda a cada 15 min e repetir o aviso ensina a ignorá-lo. Reaproveita
 * `longRideReminderAt` de propósito — uma corrida presa antes do PIN nunca chega a ser
 * uma corrida longa em andamento, então os dois avisos jamais disputam o mesmo registro.
 */
async function remindPresentialAwaitingPin() {
    const candidatas = await rideModel.find({
        status: 'accepted',
        source: 'driver_initiated',
        createdAt: { $lt: minutesAgo(PRESENTIAL_AWAITING_PIN_MINUTES) },
        longRideReminderAt: null,
        captain: { $ne: null },
    }).select('_id captain createdAt').lean();

    const avisadas = [];
    for (const ride of candidatas) {
        // eslint-disable-next-line no-await-in-loop
        const claimed = await rideModel.findOneAndUpdate(
            { _id: ride._id, status: 'accepted', longRideReminderAt: null },
            { $set: { longRideReminderAt: new Date() } },
            { new: true, projection: { _id: 1 } }
        );
        if (!claimed) continue;

        const minutesWaiting = Math.round((Date.now() - new Date(ride.createdAt).getTime()) / 60000);
        try {
            // eslint-disable-next-line no-await-in-loop
            await notificationService.sendPresentialAwaitingPinReminder(String(ride.captain), {
                rideId: String(ride._id),
                referenceId: String(ride._id),
                minutesWaiting,
            });
            avisadas.push(String(ride._id));
        } catch (err) {
            console.error('[RideHealth] lembrete de presencial sem PIN não enviado:', String(ride._id), err.message);
        }
    }

    return avisadas;
}

async function reportStuckRides() {
    // Roda antes da varredura de travadas: o lembrete é a chance de o motorista resolver
    // sozinho, e o alerta de 4h é o que sobra quando ele não resolveu.
    const remindedLongRides = await remindLongRunningRides()
        .catch((err) => {
            console.error('[RideHealth] varredura de lembretes falhou:', err.message);
            return [];
        });

    const remindedAwaitingPin = await remindPresentialAwaitingPin()
        .catch((err) => {
            console.error('[RideHealth] varredura de presencial sem PIN falhou:', err.message);
            return [];
        });

    const groups = await findStuckRides();
    const total = groups.stuckStarted.length
        + groups.stuckFinalization.length
        + groups.staleRequested.length
        + groups.presentialAwaitingPin.length;

    if (total === 0) return { total, remindedLongRides, remindedAwaitingPin, ...groups };

    // Log estruturado com os ids: é o que permite investigar sem precisar de query
    // manual no banco quando alguém relatar o problema.
    console.warn('[RideHealth] corridas travadas encontradas', {
        emAndamentoHaMuitoTempo: groups.stuckStarted.map((r) => String(r._id)),
        liquidacaoPendente: groups.stuckFinalization.map((r) => String(r._id)),
        pedidoSemMotorista: groups.staleRequested.map((r) => String(r._id)),
        presencialSemPin: groups.presentialAwaitingPin.map((r) => String(r._id)),
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

    return { total, remindedLongRides, remindedAwaitingPin, ...groups };
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
    LONG_RIDE_REMINDER_MINUTES,
    PRESENTIAL_AWAITING_PIN_MINUTES,
    remindLongRunningRides,
    remindPresentialAwaitingPin,
    STUCK_FINALIZATION_MINUTES,
    STALE_REQUESTED_MINUTES,
    findStuckRides,
    reportStuckRides,
};
