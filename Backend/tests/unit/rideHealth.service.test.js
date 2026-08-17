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
