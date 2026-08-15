const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('rotação usa sessão e transação Mongo explícitas', () => {
    const auth = read('services/auth.service.js');

    assert.match(auth, /mongoose\.startSession\(\)/);
    assert.match(auth, /withTransaction/);
    assert.match(auth, /readConcern:\s*\{\s*level:\s*['"]snapshot['"]/);
    assert.match(auth, /writeConcern:\s*\{\s*w:\s*['"]majority['"]/);
});

test('claim CAS exige token vivo e ainda sem sucessor', () => {
    const auth = read('services/auth.service.js');

    assert.match(auth, /findOneAndUpdate/);
    assert.match(auth, /revokedAt:\s*null/);
    assert.match(auth, /replacedBy:\s*null/);
    assert.match(auth, /expiresAt:\s*\{\s*\$gt:/);
    assert.doesNotMatch(auth, /stored\.save\(\)/);
});

test('sucessor é criado na mesma sessão do claim', () => {
    const auth = read('services/auth.service.js');

    assert.match(auth, /refreshTokenModel\.create\(\s*\[/);
    assert.match(auth, /\{\s*session\s*\}/);
});

test('família é persistida, propagada e revogada em reuse tardio', () => {
    const auth = read('services/auth.service.js');
    const model = read('models/refreshToken.model.js');

    assert.match(model, /familyId/);
    assert.match(auth, /familyId/);
    assert.match(auth, /reuse_detected/);
    assert.match(auth, /refreshTokenModel\.updateMany/);
});

test('graça concorrente não cria nem devolve outro refresh token', () => {
    const auth = read('services/auth.service.js');
    const user = read('controllers/user.controller.js');
    const captain = read('controllers/captain.controller.js');
    const adminClient = read('../admin-frontend/src/services/api.js');

    assert.match(auth, /graceAccessOnly:\s*true/);
    assert.match(auth, /refreshToken:\s*null/);
    assert.match(user, /if\s*\(refreshToken\)[\s\S]*REFRESH_COOKIE_BY_ACTOR\[ACTOR\]/);
    assert.match(captain, /if\s*\(refreshToken\)[\s\S]*REFRESH_COOKIE_BY_ACTOR\[ACTOR\]/);
    assert.doesNotMatch(adminClient, /localStorage\.setItem\(['"]adminRefreshToken['"]/);
});
