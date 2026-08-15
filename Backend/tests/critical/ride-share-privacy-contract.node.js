const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ride-share-contract-secret';

const {
    RIDE_SHARE_TTL_SECONDS,
    createRideShareAccess,
    verifyRideShareToken,
    validateRideShareAccess,
    toSharedRideResponse,
} = require('../../utils/rideShareAccess');

test('token compartilhado expira em uma hora e possui identificador persistível', () => {
    const access = createRideShareAccess({ rideId: 'ride-1', userId: 'user-1' });
    const payload = verifyRideShareToken(access.token);

    assert.equal(RIDE_SHARE_TTL_SECONDS, 60 * 60);
    assert.equal(payload.rideId, 'ride-1');
    assert.equal(payload.userId, 'user-1');
    assert.ok(payload.shareId);
    assert.ok(access.record.tokenHash);
    assert.doesNotMatch(access.record.tokenHash, new RegExp(payload.shareId));
    assert.equal(validateRideShareAccess(payload, access.record).valid, true);
    assert.equal(
        validateRideShareAccess(
            payload,
            access.record,
            new Date(access.record.expiresAt.getTime() + 1)
        ).reason,
        'expired'
    );
});

test('renovação invalida token anterior e revogação encerra o token atual', () => {
    const previous = createRideShareAccess({ rideId: 'ride-1', userId: 'user-1' });
    const current = createRideShareAccess({ rideId: 'ride-1', userId: 'user-1' });
    const previousPayload = verifyRideShareToken(previous.token);
    const currentPayload = verifyRideShareToken(current.token);

    assert.equal(validateRideShareAccess(previousPayload, current.record).reason, 'rotated');
    assert.equal(validateRideShareAccess(currentPayload, {
        ...current.record,
        revokedAt: new Date(),
    }).reason, 'revoked');
});

test('corrida ativa usa somente a última localização vinculada à corrida', () => {
    const response = toSharedRideResponse({
        ride: {
            _id: 'ride-1',
            status: 'started',
            pickup: 'Praça',
            destination: 'Hospital',
            lastLocation: { lat: -20.1, lng: -41.6 },
            shareLocation: { lat: -20.2, lng: -41.7 },
            updatedAt: new Date('2026-08-15T12:00:00Z'),
        },
        captain: {
            fullname: { firstname: 'Maria' },
            location: { ltd: -21.9, lng: -42.9 },
            lastSeenAt: new Date('2026-08-15T13:00:00Z'),
        },
    });

    assert.deepEqual(response.location, { lat: -20.2, lng: -41.7 });
    assert.equal(JSON.stringify(response).includes('-21.9'), false);
    assert.equal(Object.hasOwn(response.captain, 'lastSeenAt'), false);
});

test('corrida finalizada ou cancelada devolve estado final sem nenhum GPS', () => {
    for (const status of ['finished', 'cancelled']) {
        const response = toSharedRideResponse({
            ride: {
                _id: 'ride-1',
                status,
                pickup: 'Praça',
                destination: 'Hospital',
                lastLocation: { lat: -20.1, lng: -41.6 },
                shareLocation: { lat: -20.2, lng: -41.7 },
            },
            captain: {
                fullname: { firstname: 'Maria' },
                location: { ltd: -21.9, lng: -42.9 },
            },
        });

        assert.equal(Object.hasOwn(response, 'location'), false);
        assert.equal(JSON.stringify(response).includes('-20.1'), false);
        assert.equal(JSON.stringify(response).includes('-20.2'), false);
        assert.equal(JSON.stringify(response).includes('-21.9'), false);
    }
});

test('backend persiste hash revogável e nunca lê GPS atual do motorista no link', () => {
    const backendRoot = path.resolve(__dirname, '../..');
    const controllerSource = fs.readFileSync(path.join(backendRoot, 'controllers/ride.controller.js'), 'utf8');
    const routesSource = fs.readFileSync(path.join(backendRoot, 'routes/ride.routes.js'), 'utf8');
    const modelSource = fs.readFileSync(path.join(backendRoot, 'models/ride.model.js'), 'utf8');
    const socketSource = fs.readFileSync(path.join(backendRoot, 'socket.js'), 'utf8');

    assert.match(modelSource, /shareAccess/);
    assert.match(controllerSource, /createRideShareAccess/);
    assert.match(controllerSource, /validateRideShareAccess/);
    assert.match(controllerSource, /revokeRideShareLink/);
    assert.doesNotMatch(controllerSource, /captain\?\.location/);
    assert.doesNotMatch(controllerSource, /expiresIn:\s*['"]6h['"]/);
    assert.match(routesSource, /router\.delete\('\/share\/:rideId'/);
    assert.match(socketSource, /'shareAccess\.tokenHash'/);
    assert.match(socketSource, /shareLocation/);
});

test('cliente encerra polling no estado final e oferece revogação do link', () => {
    const frontendRoot = path.resolve(__dirname, '../../../frontend/src');
    const trackingSource = fs.readFileSync(
        path.join(frontendRoot, 'passenger/pages/SharedRideTracking.jsx'),
        'utf8'
    );
    const safetySource = fs.readFileSync(
        path.join(frontendRoot, 'passenger/components/PassengerSafetyCenter.jsx'),
        'utf8'
    );

    assert.match(trackingSource, /TERMINAL_STATUSES/);
    assert.match(trackingSource, /clearInterval\(interval\)/);
    assert.match(safetySource, /Encerrar compartilhamento/);
    assert.match(safetySource, /api\.delete\(`\/rides\/share\/\$\{ride\._id\}`/);
    assert.doesNotMatch(safetySource, /maps\.google\.com\/\?q=/);
});
