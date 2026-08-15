const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(backendRoot, '..');
const readBackend = (file) => fs.readFileSync(path.join(backendRoot, file), 'utf8');
const readRepo = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('utilitário normaliza e-mail e valida UID, provider Google e e-mail verificado', () => {
    const utilPath = path.join(backendRoot, 'utils/googleIdentity.js');
    assert.equal(fs.existsSync(utilPath), true, 'utils/googleIdentity.js deve existir');
    const { normalizeEmail, validateGoogleIdentityClaims } = require(utilPath);

    assert.equal(normalizeEmail('  Pessoa@Example.COM '), 'pessoa@example.com');
    const valid = validateGoogleIdentityClaims({
        uid: 'firebase-uid-1',
        email: ' Pessoa@Example.COM ',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
    });
    assert.equal(valid.uid, 'firebase-uid-1');
    assert.equal(valid.email, 'pessoa@example.com');

    for (const claims of [
        { email: 'a@b.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
        { uid: 'uid', email: 'a@b.com', email_verified: false, firebase: { sign_in_provider: 'google.com' } },
        { uid: 'uid', email: 'a@b.com', email_verified: true, firebase: { sign_in_provider: 'password' } },
    ]) {
        assert.throws(() => validateGoogleIdentityClaims(claims));
    }
});

test('modelo persiste firebaseUid único e nunca serializa credenciais', () => {
    const model = readBackend('models/user.model.js');
    assert.match(model, /firebaseUid/);
    assert.match(model, /unique:\s*true/);
    assert.match(model, /select:\s*false/);
    assert.match(model, /delete\s+ret\.password/);
    assert.match(model, /delete\s+ret\.firebaseUid/);
});

test('cadastro e login por senha normalizam antes de consultar ou salvar', () => {
    const controller = readBackend('controllers/user.controller.js');
    const service = readBackend('services/user.service.js');
    const routes = readBackend('routes/user.routes.js');
    assert.match(controller, /normalizeEmail/);
    assert.match(service, /normalizeEmail/);
    assert.match(controller, /findUserByNormalizedEmail/);
    assert.match(routes, /body\('email'\)\.trim\(\)\.toLowerCase\(\)\.isEmail\(\)/);
});

test('login Google procura primeiro por UID e não vincula conta existente sem confirmação', () => {
    const controller = readBackend('controllers/user.controller.js');
    assert.match(controller, /firebaseUid/);
    assert.match(controller, /GOOGLE_LINK_PASSWORD_REQUIRED/);
    assert.match(controller, /comparePassword/);
    assert.match(controller, /GOOGLE_ALLOW_LEGACY_EMAIL_LINK/);
    assert.match(controller, /GOOGLE_LEGACY_LINK_UNTIL/);
    assert.match(controller, /GOOGLE_LOGIN_ENABLED/);
});

test('frontend envia senha somente para confirmar vínculo solicitado', () => {
    const login = readRepo('frontend/src/passenger/pages/UserLogin.jsx');
    const signup = readRepo('frontend/src/passenger/pages/UserSignup.jsx');
    assert.match(login, /GOOGLE_LINK_PASSWORD_REQUIRED/);
    assert.match(signup, /GOOGLE_LINK_PASSWORD_REQUIRED/);
    assert.match(login, /password/);
    assert.match(signup, /password/);
});

test('auditor de e-mails é somente leitura e relata colisões normalizadas', () => {
    const script = readBackend('scripts/audit-user-email-identities.js');
    const migration = readBackend('scripts/migrate-user-email-normalization.js');
    assert.match(script, /normalizedEmail/);
    assert.match(script, /collision/i);
    assert.doesNotMatch(script, /\.(?:updateOne|updateMany|deleteOne|deleteMany|save)\s*\(/);
    assert.match(migration, /--apply/);
    assert.match(migration, /withTransaction/);
    assert.match(migration, /assertEmailNormalizationMigrationSafe/);
});

test('CI executa o contrato crítico da identidade Google', () => {
    const pkg = readBackend('package.json');
    const ci = readRepo('.github/workflows/ci.yml');
    assert.match(pkg, /test:critical:google-identity/);
    assert.match(ci, /test:critical:google-identity/);
});
