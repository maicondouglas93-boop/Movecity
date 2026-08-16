const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('schema impede duas corridas ativas e repetição da chave do passageiro', () => {
    const source = read('models/ride.model.js');
    const policy = read('config/rideCreationPolicy.js');

    assert.match(policy, /ACTIVE_PASSENGER:\s*['"]passenger_active_ride_unique['"]/);
    assert.match(policy, /PASSENGER_IDEMPOTENCY:\s*['"]passenger_ride_idempotency_unique['"]/);
    assert.match(source, /name:\s*RIDE_CREATION_INDEXES\.ACTIVE_PASSENGER/);
    assert.match(source, /name:\s*RIDE_CREATION_INDEXES\.PASSENGER_IDEMPOTENCY/);
    assert.match(source, /status:\s*\{\s*\$in:\s*PASSENGER_ACTIVE_RIDE_STATUSES/);
    assert.match(source, /idempotencyKey:\s*\{\s*\$type:\s*['"]string['"]\s*\}/);
});

test('payment e ledger do passageiro possuem unicidade por corrida', () => {
    const payment = read('models/payment.model.js');
    const ledger = read('models/userWalletTransaction.model.js');

    assert.match(payment, /name:\s*['"]ride_payment_unique['"]/);
    assert.match(ledger, /name:\s*['"]user_wallet_ride_effect_unique['"]/);
    assert.match(ledger, /ride_debit/);
});

test('criação usa uma única transação para corrida, saldo, payment, ledger e cupom', () => {
    const source = read('services/ride.service.js');
    const createStart = source.indexOf('module.exports.createRide = async');
    const createEnd = source.indexOf('module.exports.settleScheduledRideFinance', createStart);
    const createSource = source.slice(createStart, createEnd);

    assert.match(createSource, /session\.withTransaction/);
    assert.match(createSource, /rideModel\.create\([^;]+\{\s*session\s*\}/s);
    assert.match(createSource, /userModel\.updateOne\([^;]+session/s);
    assert.match(createSource, /paymentModel\.create\([^;]+session/s);
    assert.match(createSource, /userWalletTransactionModel\.create\([^;]+session/s);
    assert.match(createSource, /recordPromotionUsage\([^;]+session/s);
    assert.doesNotMatch(createSource, /userData\.save\(\)/);
});

test('retry com a mesma chave devolve a corrida existente sem novo efeito financeiro', () => {
    const source = read('services/ride.service.js');
    const policy = read('config/rideCreationPolicy.js');

    assert.match(source, /findRideByIdempotencyKey/);
    assert.match(source, /replayed:\s*true/);
    assert.match(source, /RIDE_CREATION_INDEXES\.PASSENGER_IDEMPOTENCY/);
    assert.match(policy, /passenger_ride_idempotency_unique/);
});

test('controller distingue criação de replay e aceita o header padrão', () => {
    const controller = read('controllers/ride.controller.js');
    const routes = read('routes/ride.routes.js');

    assert.match(controller, /req\.get\(['"]Idempotency-Key['"]\)/);
    assert.match(controller, /replayed\s*\?\s*200\s*:\s*201/);
    assert.match(routes, /header\(['"]Idempotency-Key['"]\)/);
});

test('painel administrativo não repete despacho quando o serviço devolve replay', () => {
    const controller = read('controllers/admin.controller.js');

    assert.match(controller, /const\s*\{\s*ride,\s*replayed\s*\}\s*=\s*await\s+rideService\.createRide/);
    assert.match(controller, /if\s*\(replayed\)[\s\S]+reused:\s*true/);
    assert.match(controller, /USER_HAS_ACTIVE_RIDE/);
});

test('apps de corrida imediata e agendada reutilizam uma chave UUID durante retry', () => {
    const home = read('../frontend/src/passenger/pages/Home.jsx');
    const scheduled = read('../frontend/src/passenger/pages/ScheduleRide.jsx');
    const helper = read('../frontend/src/shared/utils/idempotency.js');

    assert.match(home, /rideCreationKeyRef/);
    assert.match(home, /Idempotency-Key/);
    assert.match(scheduled, /rideCreationKeyRef/);
    assert.match(scheduled, /Idempotency-Key/);
    assert.match(helper, /randomUUID/);
});

test('ativação agendada adia com segurança quando já existe corrida ativa', () => {
    const source = read('services/schedule.service.js');

    assert.match(source, /passenger_active_ride_unique/);
    assert.match(source, /USER_HAS_ACTIVE_RIDE/);
});
