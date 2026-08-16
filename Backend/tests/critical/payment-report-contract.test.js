const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    PAYMENT_REPORTED_EVENT,
    evaluatePaymentReport,
    buildCaptainPaymentReportPayload,
} = require('../../utils/paymentReportContract');
const { createPaymentReportService } = require('../../services/paymentReport.service');

function mockModule(modulePath, exports) {
    const id = require.resolve(modulePath);
    const previous = require.cache[id];
    require.cache[id] = { id, filename: id, loaded: true, exports };
    return () => {
        if (previous) require.cache[id] = previous;
        else delete require.cache[id];
    };
}

function responseRecorder() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

function domainCode(fn) {
    try {
        fn();
        return null;
    } catch (error) {
        return error.code;
    }
}

function queryResult(value) {
    const query = {
        populate() {
            return query;
        },
        then(resolve, reject) {
            return Promise.resolve(value).then(resolve, reject);
        },
    };
    return query;
}

test('recusa comunicação de pagamento antes de a corrida estar finalizada', () => {
    assert.equal(domainCode(() => evaluatePaymentReport({
        status: 'started',
        paymentStatus: 'pending',
        paymentMethod: 'cash',
    })), 'RIDE_NOT_FINISHED');
});

test('aceita somente dinheiro/Pix pendente e diferencia informação de liquidação', () => {
    assert.deepEqual(evaluatePaymentReport({
        status: 'finished',
        paymentStatus: 'pending',
        paymentMethod: 'cash',
        paymentReportedAt: null,
    }), {
        reportStatus: 'reported',
        shouldNotify: true,
    });

    assert.equal(domainCode(() => evaluatePaymentReport({
        status: 'finished',
        paymentStatus: 'pending',
        paymentMethod: 'carteira',
    })), 'PAYMENT_REPORT_NOT_ALLOWED');
});

test('repetição é idempotente e pagamento já liquidado não gera nova notificação', () => {
    assert.deepEqual(evaluatePaymentReport({
        status: 'finished',
        paymentStatus: 'pending',
        paymentMethod: 'pix',
        paymentReportedAt: new Date('2026-08-15T12:00:00Z'),
    }), {
        reportStatus: 'already_reported',
        shouldNotify: false,
    });

    assert.deepEqual(evaluatePaymentReport({
        status: 'finished',
        paymentStatus: 'paid',
        paymentMethod: 'pix',
    }), {
        reportStatus: 'already_confirmed',
        shouldNotify: false,
    });
});

test('evento usa semântica de informação e payload allowlist', () => {
    assert.equal(PAYMENT_REPORTED_EVENT, 'payment-reported');
    const payload = buildCaptainPaymentReportPayload({
        _id: 'ride-1',
        status: 'finished',
        paymentStatus: 'pending',
        paymentMethod: 'pix',
        finalPrice: 42.5,
        paymentReportedAt: new Date('2026-08-15T12:00:00Z'),
        user: { cpf: 'não pode vazar' },
        captain: { bankData: 'não pode vazar' },
    });

    assert.deepEqual(Object.keys(payload).sort(), [
        'amount',
        'paymentMethod',
        'paymentStatus',
        'reportedAt',
        'rideId',
        'status',
    ]);
    assert.equal(payload.rideId, 'ride-1');
    assert.equal(payload.amount, 42.5);
});

test('serviço grava o primeiro informe com guarda atômica', async () => {
    const original = {
        _id: 'ride-1',
        user: 'user-1',
        captain: { _id: 'captain-1', socketId: 'socket-1' },
        status: 'finished',
        paymentStatus: 'pending',
        paymentMethod: 'cash',
        paymentReportedAt: null,
        finalPrice: 30,
    };
    const updated = { ...original, paymentReportedAt: new Date('2026-08-15T12:00:00Z') };
    const calls = [];
    const rideModel = {
        findOne(filter) {
            calls.push({ operation: 'findOne', filter });
            return queryResult(original);
        },
        findOneAndUpdate(filter, update, options) {
            calls.push({ operation: 'findOneAndUpdate', filter, update, options });
            return queryResult(updated);
        },
    };

    const service = createPaymentReportService({ rideModel, now: () => updated.paymentReportedAt });
    const result = await service.reportPayment({ rideId: 'ride-1', user: { _id: 'user-1' } });

    assert.equal(result.reportStatus, 'reported');
    assert.equal(result.shouldNotify, true);
    assert.equal(calls[1].filter.status, 'finished');
    assert.equal(calls[1].filter.paymentStatus, 'pending');
    assert.deepEqual(calls[1].filter.paymentMethod, { $in: ['cash', 'pix'] });
    assert.equal(calls[1].filter.paymentReportedAt, null);
    assert.equal(calls[1].options.new, true);
});

test('controller responde 409 e não emite evento quando corrida não terminou', async () => {
    const socketMessages = [];
    const restores = [
        mockModule('../../services/ride.service', {
            payRide: async () => {
                const error = new Error('Ride not finished yet');
                error.code = 'RIDE_NOT_FINISHED';
                throw error;
            },
        }),
        mockModule('../../services/maps.service', {}),
        mockModule('../../socket', {
            sendMessageToSocketId: (...args) => socketMessages.push(args),
            addSocketToRoom() {},
            sendMessageToRoom() {},
            emitDriverMapUpdate() {},
        }),
        mockModule('../../models/ride.model', {}),
        mockModule('../../cache/cache', {
            getCache() {},
            setCache() {},
            deleteByPrefix() {},
        }),
        mockModule('../../services/notification.service', {
            sendPaymentReported: async () => {},
        }),
        mockModule('../../services/liveRideFare.service', {}),
    ];
    const controllerId = require.resolve('../../controllers/ride.controller');
    delete require.cache[controllerId];

    try {
        const controller = require('../../controllers/ride.controller');
        const res = responseRecorder();
        await controller.payRide({ body: { rideId: 'ride-1' }, user: { _id: 'user-1' } }, res);
        assert.equal(res.statusCode, 409);
        assert.equal(socketMessages.length, 0);
    } finally {
        delete require.cache[controllerId];
        restores.reverse().forEach((restore) => restore());
    }
});

test('controller emite payment-reported uma vez sem afirmar liquidação', async () => {
    const socketMessages = [];
    const pushes = [];
    const ride = {
        _id: 'ride-1',
        status: 'finished',
        paymentStatus: 'pending',
        paymentMethod: 'pix',
        paymentReportedAt: new Date('2026-08-15T12:00:00Z'),
        finalPrice: 35,
        captain: { _id: 'captain-1', socketId: 'socket-1' },
    };
    const restores = [
        mockModule('../../services/ride.service', {
            payRide: async () => ({ ride, reportStatus: 'reported', shouldNotify: true }),
        }),
        mockModule('../../services/maps.service', {}),
        mockModule('../../socket', {
            sendMessageToSocketId: (...args) => socketMessages.push(args),
            addSocketToRoom() {},
            sendMessageToRoom() {},
            emitDriverMapUpdate() {},
        }),
        mockModule('../../models/ride.model', {}),
        mockModule('../../cache/cache', {
            getCache() {},
            setCache() {},
            deleteByPrefix() {},
        }),
        mockModule('../../services/notification.service', {
            sendPaymentReported: async (...args) => pushes.push(args),
        }),
        mockModule('../../services/liveRideFare.service', {}),
    ];
    const controllerId = require.resolve('../../controllers/ride.controller');
    delete require.cache[controllerId];

    try {
        const controller = require('../../controllers/ride.controller');
        const res = responseRecorder();
        await controller.payRide({ body: { rideId: 'ride-1' }, user: { _id: 'user-1' } }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reportStatus, 'reported');
        assert.equal(res.body.paymentStatus, 'pending');
        assert.equal(socketMessages.length, 1);
        assert.equal(socketMessages[0][1].event, 'payment-reported');
        assert.equal(socketMessages[0][1].data.rideId, 'ride-1');
        assert.equal(pushes.length, 1);
    } finally {
        delete require.cache[controllerId];
        restores.reverse().forEach((restore) => restore());
    }
});

test('frontend do motorista não limpa corrida nem navega ao receber apenas o informe', () => {
    const source = fs.readFileSync(path.resolve(
        __dirname,
        '../../../frontend/src/driver/pages/CaptainRiding.jsx'
    ), 'utf8');
    const start = source.indexOf('const handlePaymentReported');
    const end = source.indexOf('const handleReceiveMessage', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const handler = source.slice(start, end);
    assert.doesNotMatch(handler, /setCaptainRide\s*\(\s*null/);
    assert.doesNotMatch(handler, /navigate\s*\(/);
    assert.match(source, /socket\.on\('payment-reported'/);
    assert.doesNotMatch(source, /payment-completed/);
});
