jest.mock('../../models/user.model', () => ({}));
jest.mock('../../models/captain.model', () => ({}));
jest.mock('../../models/blacklistToken.model', () => ({}));
jest.mock('../../services/user.service', () => ({ getUserProfile: jest.fn() }));
jest.mock('../../services/captain.service', () => ({ getCaptainProfile: jest.fn() }));
jest.mock('../../services/notification.service', () => ({}));
jest.mock('../../services/auth.service', () => ({
    rotateRefreshToken: jest.fn(),
    generateAccessToken: jest.fn(() => 'access-novo'),
    refreshCookieOptions: jest.fn(() => ({})),
    revokeAllForUser: jest.fn(),
}));

const authService = require('../../services/auth.service');
const userService = require('../../services/user.service');
const captainService = require('../../services/captain.service');
const { refreshUserSession } = require('../../controllers/user.controller');
const { refreshCaptainSession } = require('../../controllers/captain.controller');
const { sendAuthFailure } = require('../../utils/authFailure');

const response = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
});

describe.each([
    ['user', refreshUserSession, userService.getUserProfile],
    ['captain', refreshCaptainSession, captainService.getCaptainProfile],
])('recuperação do refresh de %s', (kind, refresh, getProfile) => {
    let res;
    const req = { body: { refreshToken: 'salvo' }, cookies: {}, ip: '127.0.0.1' };
    beforeEach(() => {
        jest.clearAllMocks();
        res = response();
        authService.rotateRefreshToken.mockResolvedValue({ userId: 'id', userType: kind, refreshToken: 'novo' });
        getProfile.mockResolvedValue({ _id: 'id' });
    });

    it.each(['MISSING_REFRESH_TOKEN', 'INVALID_REFRESH_TOKEN', 'EXPIRED_REFRESH_TOKEN', 'REFRESH_ACTOR_MISMATCH', 'REFRESH_TOKEN_REUSE'])(
        '%s continua encerrando a sessão com 401', async (code) => {
            authService.rotateRefreshToken.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
            await refresh(req, res);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.cookie).not.toHaveBeenCalled();
        },
    );

    it.each([undefined, 'REFRESH_ROTATION_CONFLICT'])('falha temporária %s retorna 503 sem expor erro interno', async (code) => {
        authService.rotateRefreshToken.mockRejectedValueOnce(Object.assign(new Error('dados internos do banco'), { code }));
        await refresh(req, res);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(JSON.stringify(res.json.mock.calls)).not.toContain('dados internos');
        expect(res.cookie).not.toHaveBeenCalled();
    });

    it('erro de banco depois da rotação não vira 401', async () => {
        getProfile.mockRejectedValueOnce(new Error('Mongo offline'));
        await refresh(req, res);
        expect(res.status).toHaveBeenCalledWith(503);
    });

    it('recupera normalmente na próxima chamada', async () => {
        authService.rotateRefreshToken.mockRejectedValueOnce(new Error('Mongo offline'));
        await refresh(req, res);
        expect(res.status).toHaveBeenLastCalledWith(503);
        await refresh(req, res);
        expect(res.status).toHaveBeenLastCalledWith(200);
        expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'access-novo', refreshToken: 'novo' }));
    });

    it('prioriza o token do app sobre um cookie antigo ou do outro papel', async () => {
        await refresh({ ...req, cookies: { refreshToken: 'cookie-de-outra-sessao' } }, res);
        expect(authService.rotateRefreshToken).toHaveBeenCalledWith(expect.objectContaining({
            refreshToken: 'salvo', expectedUserType: kind,
        }));
    });

    it('mantém suporte ao cookie quando não há token no corpo', async () => {
        await refresh({ ...req, body: {}, cookies: { refreshToken: 'cookie-valido' } }, res);
        expect(authService.rotateRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'cookie-valido' }));
    });

    it('bloqueio continua revogando e recusando a conta', async () => {
        getProfile.mockResolvedValueOnce({ _id: 'id', isBlocked: true });
        await refresh(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(authService.revokeAllForUser).toHaveBeenCalledWith({ userId: 'id', userType: kind, reason: 'blocked' });
    });
});

describe('classificação explícita de falhas de autenticação', () => {
    it.each(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'])('%s retorna 401', (name) => {
        const res = response();
        sendAuthFailure(res, { name });
        expect(res.status).toHaveBeenCalledWith(401);
    });
    it('configuração incorreta do servidor não invalida credenciais do usuário', () => {
        const res = response();
        sendAuthFailure(res, { code: 'TOKEN_SECRET_NOT_CONFIGURED' });
        expect(res.status).toHaveBeenCalledWith(503);
    });
});
