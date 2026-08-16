const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('access token v2 fixa subject, ator, finalidade, issuer, audience e jti', () => {
    const auth = read('services/auth.service.js');

    assert.match(auth, /actorType/);
    assert.match(auth, /tokenType:\s*['"]access['"]/);
    assert.match(auth, /subject:/);
    assert.match(auth, /issuer:/);
    assert.match(auth, /audience:/);
    assert.match(auth, /jwtid:/);
    assert.match(auth, /TOKEN_VERSION/);
});

test('segredos de acesso, ADM e compartilhamento têm configuração separada', () => {
    const auth = read('services/auth.service.js');
    const env = read('.env.example');

    for (const name of ['JWT_ACCESS_SECRET', 'JWT_ADMIN_SECRET', 'JWT_SHARE_SECRET']) {
        assert.match(auth, new RegExp(name));
        assert.match(env, new RegExp(`^${name}=`, 'm'));
    }
});

test('middlewares validam ator antes de consultar a coleção', () => {
    const common = read('middlewares/auth.middleware.js');
    const admin = read('middlewares/adminAuth.middleware.js');

    assert.match(common, /verifyAccessToken\(token,\s*['"]user['"]\)/);
    assert.match(common, /verifyAccessToken\(token,\s*['"]captain['"]\)/);
    assert.match(common, /verifyAccessToken\(token,\s*\[['"]user['"],\s*['"]captain['"]\]\)/);
    assert.match(admin, /verifyAccessToken\(token,\s*['"]admin['"]\)/);
    assert.doesNotMatch(common, /jwt\.verify/);
    assert.doesNotMatch(admin, /jwt\.verify/);
});

test('refresh não pode trocar sessão entre passageiro, motorista e ADM', () => {
    const user = read('controllers/user.controller.js');
    const captain = read('controllers/captain.controller.js');
    const admin = read('services/admin.service.js');

    assert.match(user, /userType\s*!==\s*['"]user['"]/);
    assert.match(captain, /userType\s*!==\s*['"]captain['"]/);
    assert.match(admin, /userType\s*!==\s*['"]admin['"]/);
});

test('Socket.IO usa o ator assinado, não descoberta por coleção ou userType livre', () => {
    const socket = read('socket.js');

    assert.match(socket, /verifyAccessToken/);
    assert.match(socket, /decoded\.actorType/);
    assert.doesNotMatch(socket, /jwt\.verify/);
    assert.doesNotMatch(socket, /identifiedUser[\s\S]+identifiedCaptain/);
});

test('token de compartilhamento tem finalidade, audience e segredo próprios', () => {
    const auth = read('services/auth.service.js');
    const ride = read('controllers/ride.controller.js');
    const rideShareAccess = read('utils/rideShareAccess.js');

    assert.match(auth, /signShareToken/);
    assert.match(auth, /verifyShareToken/);
    assert.match(auth, /tokenType:\s*['"]share['"]/);
    assert.match(auth, /shareTokenSecret/);
    // O link de compartilhamento revogável (createRideShareAccess/verifyRideShareToken,
    // com hash do identificador e revogação server-side) chama o mesmo segredo dedicado
    // exportado por auth.service.js — nunca cai de volta no JWT_SECRET genérico.
    assert.match(ride, /createRideShareAccess/);
    assert.match(ride, /verifyRideShareToken/);
    assert.doesNotMatch(ride, /jwt\.(?:sign|verify)/);
    assert.match(rideShareAccess, /shareTokenSecret/);
    assert.doesNotMatch(rideShareAccess, /process\.env\.JWT_SECRET/);
});

test('models deixam de emitir JWT sem ator pelo segredo genérico', () => {
    for (const model of ['models/user.model.js', 'models/captain.model.js', 'models/adminUser.model.js']) {
        const source = read(model);
        assert.doesNotMatch(source, /jwt\.sign/);
        assert.match(source, /generateAccessToken/);
    }
});
