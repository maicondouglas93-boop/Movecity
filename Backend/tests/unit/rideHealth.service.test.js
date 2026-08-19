const rideModel = require('../../models/ride.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const rideHealth = require('../../services/rideHealth.service');
const notificationService = require('../../services/notification.service');

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000);
const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

// Achado P4 da auditoria de fluxos (2026-08-17): nenhum job olhava para corridas que
// pararam de andar. Os defeitos de finalização corrigidos em 16-17/ago só apareceram
// porque um motorista reclamou — não havia como descobrir antes.
describe('varredura de corridas travadas', () => {
    beforeEach(() => {
        jest.spyOn(notificationService, 'sendAdminAlert').mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // Índice passenger_active_ride_unique: um passageiro só pode ter uma corrida ativa,
    // então cada corrida de teste precisa do seu próprio usuário.
    async function seedRide(overrides = {}) {
        const [user, captain] = await Promise.all([createUser(), createCaptain()]);
        return createRide({ user: user._id, captain: captain._id, ...overrides });
    }

    // createdAt é gerenciado pelo mongoose (timestamps) e ignora $set num update comum —
    // por isso a escrita vai pelo driver bruto, mesma técnica de schedule.phase1.test.js.
    async function backdateCreatedAt(rideId, date) {
        await rideModel.collection.updateOne({ _id: rideId }, { $set: { createdAt: date } });
    }

    it('encontra corrida presa em andamento há horas', async () => {
        const stuck = await seedRide({ status: 'started', startedAt: hoursAgo(6) });
        await seedRide({ status: 'started', startedAt: minutesAgo(20) });

        const { stuckStarted } = await rideHealth.findStuckRides();

        expect(stuckStarted.map((r) => String(r._id))).toEqual([String(stuck._id)]);
    });

    it('encontra finalização que não liquidou', async () => {
        const pending = await seedRide({
            status: 'finished', finalizationState: 'retry_required', finishedAt: hoursAgo(2),
        });
        // Concluída normalmente não deve aparecer.
        await seedRide({
            status: 'finished', finalizationState: 'completed', finishedAt: hoursAgo(2),
        });

        const { stuckFinalization } = await rideHealth.findStuckRides();

        expect(stuckFinalization.map((r) => String(r._id))).toEqual([String(pending._id)]);
    });

    it('encontra pedido antigo que ninguém aceitou', async () => {
        const stale = await seedRide({ status: 'requested' });
        await backdateCreatedAt(stale._id, hoursAgo(3));
        // Pedido recente não deve aparecer.
        await seedRide({ status: 'requested' });

        const { staleRequested } = await rideHealth.findStuckRides();

        expect(staleRequested.map((r) => String(r._id))).toEqual([String(stale._id)]);
    });

    it('não altera nenhuma corrida — só detecta', async () => {
        const stuck = await seedRide({ status: 'started', startedAt: hoursAgo(6) });

        await rideHealth.reportStuckRides();

        const after = await rideModel.findById(stuck._id);
        expect(after.status).toBe('started');
        expect(after.cancelledAt).toBeFalsy();
    });

    it('alerta o painel apenas quando há liquidação pendente', async () => {
        await seedRide({
            status: 'finished', finalizationState: 'finished_pending_payment', finishedAt: hoursAgo(2),
        });

        await rideHealth.reportStuckRides();

        expect(notificationService.sendAdminAlert).toHaveBeenCalledTimes(1);
    });

    // Pedido sem motorista é comum em horário de baixa demanda: alertar a cada 15 min
    // viraria ruído e o painel deixaria de ser lido.
    it('não alerta por pedido sem motorista', async () => {
        const stale = await seedRide({ status: 'requested' });
        await backdateCreatedAt(stale._id, hoursAgo(3));

        await rideHealth.reportStuckRides();

        expect(notificationService.sendAdminAlert).not.toHaveBeenCalled();
    });

    it('não alerta quando está tudo em ordem', async () => {
        await seedRide({ status: 'started', startedAt: minutesAgo(10) });

        const result = await rideHealth.reportStuckRides();

        expect(result.total).toBe(0);
        expect(notificationService.sendAdminAlert).not.toHaveBeenCalled();
    });
});

/**
 * Lembrete ao motorista de corrida aberta há tempo demais.
 *
 * O caso comum não é defeito de sistema: o motorista sai do app (ou o Android mata) e a
 * corrida fica aberta. O alerta de 4h existia só para o operador — o motorista, que é
 * quem pode resolver com um toque, nunca era avisado.
 */
describe('lembrete de corrida aberta há muito tempo', () => {
    beforeEach(() => {
        jest.spyOn(notificationService, 'sendLongRideReminder').mockResolvedValue(undefined);
        jest.spyOn(notificationService, 'sendAdminAlert').mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const corridaAberta = async (overrides = {}) => {
        const user = await createUser();
        const captain = await createCaptain();
        return createRide({
            user: user._id,
            captain: captain._id,
            status: 'started',
            startedAt: minutesAgo(rideHealth.LONG_RIDE_REMINDER_MINUTES + 10),
            ...overrides,
        });
    };

    it('avisa o motorista, com o tempo real da corrida', async () => {
        const ride = await corridaAberta();

        const avisadas = await rideHealth.remindLongRunningRides();

        expect(avisadas).toContain(String(ride._id));
        expect(notificationService.sendLongRideReminder).toHaveBeenCalledTimes(1);
        const [captainId, data] = notificationService.sendLongRideReminder.mock.calls[0];
        expect(String(captainId)).toBe(String(ride.captain));
        expect(data.rideId).toBe(String(ride._id));
        expect(data.minutesRunning).toBeGreaterThanOrEqual(rideHealth.LONG_RIDE_REMINDER_MINUTES);
    });

    it('avisa UMA vez só, mesmo com a varredura rodando de novo', async () => {
        await corridaAberta();

        await rideHealth.remindLongRunningRides();
        const segunda = await rideHealth.remindLongRunningRides();

        expect(segunda).toHaveLength(0);
        expect(notificationService.sendLongRideReminder).toHaveBeenCalledTimes(1);
    });

    it('não incomoda corrida recente', async () => {
        await corridaAberta({ startedAt: minutesAgo(5) });

        const avisadas = await rideHealth.remindLongRunningRides();

        expect(avisadas).toHaveLength(0);
        expect(notificationService.sendLongRideReminder).not.toHaveBeenCalled();
    });

    // Corrida contratada por tempo é longa por definição — o lembrete cutucaria quem
    // está fazendo exatamente o que foi combinado.
    it('não incomoda corrida de motorista à disposição', async () => {
        await corridaAberta({ optionals: [{ type: 'disposicao_passageiro', price: 15 }] });

        const avisadas = await rideHealth.remindLongRunningRides();

        expect(avisadas).toHaveLength(0);
        expect(notificationService.sendLongRideReminder).not.toHaveBeenCalled();
    });

    it('não avisa corrida que já foi finalizada', async () => {
        await corridaAberta({ status: 'finished' });

        const avisadas = await rideHealth.remindLongRunningRides();

        expect(avisadas).toHaveLength(0);
    });

    it('a varredura completa dispara o lembrete junto', async () => {
        const ride = await corridaAberta();

        const resultado = await rideHealth.reportStuckRides();

        expect(resultado.remindedLongRides).toContain(String(ride._id));
    });
});

/**
 * Presencial parada antes do PIN (achado P2 da auditoria do presencial, 2026-08-19).
 *
 * Ela nasce em 'accepted' e só vira 'started' quando o motorista digita o PIN. Se o
 * passageiro desiste e ele fecha o app, a corrida fica aberta com o busyLock: ele para de
 * receber oferta e nada diz por quê. Era o único estado travado sobre o qual ninguém
 * era avisado — a varredura olhava started, finished pendente e requested, nunca accepted.
 */
describe('lembrete de presencial esperando o PIN', () => {
    beforeEach(() => {
        jest.spyOn(notificationService, 'sendPresentialAwaitingPinReminder').mockResolvedValue(undefined);
        jest.spyOn(notificationService, 'sendLongRideReminder').mockResolvedValue(undefined);
        jest.spyOn(notificationService, 'sendAdminAlert').mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const presencialParada = async (overrides = {}) => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({
            user: user._id,
            captain: captain._id,
            status: 'accepted',
            source: 'driver_initiated',
            ...overrides,
        });
        // createdAt é imutável no Mongoose: precisa ir pelo driver nativo.
        await rideModel.collection.updateOne(
            { _id: ride._id },
            { $set: { createdAt: minutesAgo(rideHealth.PRESENTIAL_AWAITING_PIN_MINUTES + 5) } }
        );
        return ride;
    };

    it('avisa o motorista, dizendo há quanto tempo a corrida está aberta', async () => {
        const ride = await presencialParada();

        const avisadas = await rideHealth.remindPresentialAwaitingPin();

        expect(avisadas).toContain(String(ride._id));
        const [captainId, data] = notificationService.sendPresentialAwaitingPinReminder.mock.calls[0];
        expect(String(captainId)).toBe(String(ride.captain));
        expect(data.rideId).toBe(String(ride._id));
        expect(data.minutesWaiting).toBeGreaterThanOrEqual(rideHealth.PRESENTIAL_AWAITING_PIN_MINUTES);
    });

    it('avisa uma vez só', async () => {
        await presencialParada();

        await rideHealth.remindPresentialAwaitingPin();
        const segunda = await rideHealth.remindPresentialAwaitingPin();

        expect(segunda).toHaveLength(0);
        expect(notificationService.sendPresentialAwaitingPinReminder).toHaveBeenCalledTimes(1);
    });

    it('não incomoda corrida recém-criada, que ainda está na conversa do PIN', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        await createRide({
            user: user._id, captain: captain._id, status: 'accepted', source: 'driver_initiated',
        });

        const avisadas = await rideHealth.remindPresentialAwaitingPin();

        expect(avisadas).toHaveLength(0);
    });

    // Corrida despachada pelo app fica em 'accepted' enquanto o motorista se desloca até
    // o embarque — é o funcionamento normal dela, não um travamento.
    it('não confunde com corrida despachada a caminho do embarque', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({
            user: user._id, captain: captain._id, status: 'accepted', source: 'passenger_requested',
        });
        await rideModel.collection.updateOne(
            { _id: ride._id },
            { $set: { createdAt: minutesAgo(120) } }
        );

        const avisadas = await rideHealth.remindPresentialAwaitingPin();

        expect(avisadas).toHaveLength(0);
        expect(notificationService.sendPresentialAwaitingPinReminder).not.toHaveBeenCalled();
    });

    it('a varredura completa dispara o lembrete e reporta o grupo ao operador', async () => {
        const ride = await presencialParada();

        const resultado = await rideHealth.reportStuckRides();

        expect(resultado.remindedAwaitingPin).toContain(String(ride._id));
        expect(resultado.presentialAwaitingPin.map((r) => String(r._id))).toContain(String(ride._id));
    });
});
