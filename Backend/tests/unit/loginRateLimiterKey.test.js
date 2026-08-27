const { loginIdentityKey, loginIpKey } = require('../../middlewares/rateLimiter');

function requestFor(email, ip = '203.0.113.10') {
    return {
        baseUrl: '/captains',
        path: '/login',
        ip,
        body: { email },
    };
}

describe('chaves do limite de login', () => {
    it('separa contas diferentes no mesmo IP compartilhado', () => {
        const first = requestFor('primeiro@example.com');
        const second = requestFor('segundo@example.com');

        expect(loginIdentityKey(first)).not.toBe(loginIdentityKey(second));
        expect(loginIpKey(first)).toBe(loginIpKey(second));
    });

    it('normaliza maiúsculas e espaços para não contornar o limite da conta', () => {
        const normal = requestFor('motorista@example.com');
        const formatted = requestFor('  MOTORISTA@EXAMPLE.COM  ');

        expect(loginIdentityKey(normal)).toBe(loginIdentityKey(formatted));
    });
});
