const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'driver-map-contract-secret';

const {
    PUBLIC_DRIVER_MAP_RADIUS_KM,
    createPublicMapSubscription,
    verifyPublicMapSubscription,
    publicDriverId,
    toPublicLocation,
    isWithinPublicMapRadius,
    toPublicDriver,
} = require('../../utils/publicDriverMap');

test('assinatura do mapa vincula passageiro, centro e expira em poucos minutos', () => {
    const center = { lat: -20.154, lng: -41.622 };
    const subscription = createPublicMapSubscription({ userId: 'user-1', center });
    const decoded = verifyPublicMapSubscription(subscription.token);

    assert.equal(decoded.userId, 'user-1');
    assert.deepEqual(decoded.center, center);
    assert.equal(decoded.nonce, subscription.nonce);
    assert.ok(subscription.expiresAt > Date.now());
    assert.ok(subscription.expiresAt - Date.now() <= 5 * 60 * 1000);

    const expired = jwt.sign(
        { purpose: 'public-driver-map', sub: 'user-1', lat: center.lat, lng: center.lng, nonce: 'expired' },
        process.env.JWT_SECRET,
        { expiresIn: -1 }
    );
    assert.throws(() => verifyPublicMapSubscription(expired));
});

test('identificador público é estável só dentro da assinatura e não revela o id real', () => {
    const realId = '507f1f77bcf86cd799439011';
    const first = publicDriverId(realId, 'nonce-a');
    const sameSubscription = publicDriverId(realId, 'nonce-a');
    const nextSubscription = publicDriverId(realId, 'nonce-b');

    assert.equal(first, sameSubscription);
    assert.notEqual(first, nextSubscription);
    assert.doesNotMatch(first, new RegExp(realId));
    assert.match(first, /^drv_[a-f0-9]{24}$/);
});

test('pré-corrida reduz precisão e respeita exatamente o raio do despacho', () => {
    assert.equal(PUBLIC_DRIVER_MAP_RADIUS_KM, 15);
    assert.deepEqual(
        toPublicLocation({ ltd: -20.154789, lng: -41.622987 }),
        { ltd: -20.155, lng: -41.623 }
    );

    const center = { lat: -20.154, lng: -41.622 };
    assert.equal(isWithinPublicMapRadius(center, { ltd: -20.16, lng: -41.63 }), true);
    assert.equal(isWithinPublicMapRadius(center, { ltd: -20.4, lng: -41.9 }), false);
});

test('DTO público usa allowlist e elimina dados pessoais do motorista', () => {
    const realId = '507f1f77bcf86cd799439011';
    const driver = toPublicDriver({
        _id: realId,
        fullname: { firstname: 'Nome', lastname: 'Privado' },
        email: 'privado@example.com',
        phone: '+5500000000000',
        vehicle: { vehicleType: 'car', plate: 'ABC1D23', color: 'Preto' },
        vehicleAuthorization: { status: 'approved' },
        location: { ltd: -20.154789, lng: -41.622987 },
    }, 'nonce-allowlist');

    assert.deepEqual(Object.keys(driver).sort(), [
        'id',
        'location',
        'vehicleAuthorization',
        'vehicleType',
    ]);
    assert.equal(driver.id, publicDriverId(realId, 'nonce-allowlist'));
    assert.deepEqual(driver.location, { ltd: -20.155, lng: -41.623 });
    assert.equal(JSON.stringify(driver).includes(realId), false);
    assert.equal(JSON.stringify(driver).includes('privado@example.com'), false);
    assert.equal(JSON.stringify(driver).includes('ABC1D23'), false);
});

test('backend não usa sala global nem publica id/posição exatos da frota', () => {
    const backendRoot = path.resolve(__dirname, '../..');
    const socketSource = fs.readFileSync(path.join(backendRoot, 'socket.js'), 'utf8');
    const controllerSource = fs.readFileSync(path.join(backendRoot, 'controllers/map.controller.js'), 'utf8');
    const routesSource = fs.readFileSync(path.join(backendRoot, 'routes/maps.routes.js'), 'utf8');

    assert.doesNotMatch(socketSource, /socket\.join\(['"]map-viewers['"]\)/);
    assert.doesNotMatch(socketSource, /io\.to\(['"]map-viewers['"]\)/);
    assert.match(socketSource, /driverMapSubscription/);
    assert.match(socketSource, /subscriptionToken/);
    assert.doesNotMatch(controllerSource, /id:\s*c\._id/);
    assert.match(controllerSource, /X-Driver-Map-Subscription/);
    assert.match(controllerSource, /Cache-Control', 'private, no-store/);
    assert.match(routesSource, /publicDriverMapLimiter/);
});

test('frontend só assina o socket com token curto emitido pelo snapshot', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../../frontend/src/shared/components/LiveTracking.jsx'),
        'utf8'
    );

    assert.match(source, /x-driver-map-subscription/);
    assert.match(source, /subscribe-drivers-map', \{ subscriptionToken/);
    assert.doesNotMatch(source, /subscribe-drivers-map', \{ token \}/);
    assert.match(source, /drivers-map-expired/);
});
