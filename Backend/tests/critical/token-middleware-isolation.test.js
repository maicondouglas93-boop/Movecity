process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'legacy-secret-for-middleware';
process.env.JWT_ACCESS_SECRET = 'access-secret-for-middleware';
process.env.JWT_ADMIN_SECRET = 'admin-secret-for-middleware';
process.env.JWT_SHARE_SECRET = 'share-secret-for-middleware';
process.env.JWT_ISSUER = 'movecity-middleware-test';
process.env.JWT_ACCEPT_LEGACY_TOKENS = 'false';

jest.mock('../../models/blacklistToken.model', () => ({ findOne: jest.fn() }));
jest.mock('../../services/user.service', () => ({ getUserProfile: jest.fn() }));
jest.mock('../../services/captain.service', () => ({ getCaptainProfile: jest.fn() }));
jest.mock('../../models/adminUser.model', () => ({ findById: jest.fn() }));

const authService = require('../../services/auth.service');
const blackListTokenModel = require('../../models/blacklistToken.model');
const userService = require('../../services/user.service');
const captainService = require('../../services/captain.service');
const adminUserModel = require('../../models/adminUser.model');
const { authUser, authCaptain } = require('../../middlewares/auth.middleware');
const { authAdmin } = require('../../middlewares/adminAuth.middleware');

const SHARED_OBJECT_ID = '66c000000000000000000099';

function requestWith(token) {
    return { cookies: {}, headers: { authorization: `Bearer ${token}` } };
}

function responseDouble() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

describe('isolamento de ator nos middlewares com o mesmo ObjectId', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        blackListTokenModel.findOne.mockResolvedValue(null);
    });

    test('token de passageiro não consulta nem autentica motorista', async () => {
        const token = authService.generateAccessToken(SHARED_OBJECT_ID, 'user');
        const res = responseDouble();
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        await authCaptain(requestWith(token), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(captainService.getCaptainProfile).not.toHaveBeenCalled();
        log.mockRestore();
    });

    test('token de motorista não consulta nem autentica passageiro', async () => {
        const token = authService.generateAccessToken(SHARED_OBJECT_ID, 'captain');
        const res = responseDouble();

        await authUser(requestWith(token), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(userService.getUserProfile).not.toHaveBeenCalled();
    });

    test('token comum não consulta nem autentica administrador', async () => {
        const token = authService.generateAccessToken(SHARED_OBJECT_ID, 'user');
        const res = responseDouble();

        await authAdmin(requestWith(token), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(adminUserModel.findById).not.toHaveBeenCalled();
    });

    test('token de compartilhamento não consulta nem autentica passageiro', async () => {
        const token = authService.signShareToken({
            rideId: '66c000000000000000000088',
            userId: SHARED_OBJECT_ID,
        });
        const res = responseDouble();

        await authUser(requestWith(token), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(userService.getUserProfile).not.toHaveBeenCalled();
    });
});
