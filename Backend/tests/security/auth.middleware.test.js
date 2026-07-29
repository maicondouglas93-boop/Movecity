const { authUser, authCaptain, authBoth } = require('../../middlewares/auth.middleware');
const jwt = require('jsonwebtoken');
const blackListTokenModel = require('../../models/blacklistToken.model');
const userService = require('../../services/user.service');
const captainService = require('../../services/captain.service');

jest.mock('jsonwebtoken');
jest.mock('../../models/blacklistToken.model');
jest.mock('../../services/user.service');
jest.mock('../../services/captain.service');

describe('Auth Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            cookies: {},
            headers: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('authUser', () => {
        it('should return 401 if no token provided', async () => {
            await authUser(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
        });

        it('should return 401 if token is blacklisted', async () => {
            req.headers.authorization = 'Bearer testtoken';
            blackListTokenModel.findOne.mockResolvedValue({ token: 'testtoken' });

            await authUser(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
        });

        it('should return 401 if token is invalid', async () => {
            req.headers.authorization = 'Bearer testtoken';
            blackListTokenModel.findOne.mockResolvedValue(null);
            jwt.verify.mockImplementation(() => { throw new Error('Invalid token') });

            await authUser(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('should call next and populate req.user if token is valid', async () => {
            req.headers.authorization = 'Bearer testtoken';
            blackListTokenModel.findOne.mockResolvedValue(null);
            jwt.verify.mockReturnValue({ _id: 'userid' });
            userService.getUserProfile.mockResolvedValue({ _id: 'userid', fullname: { firstname: 'John' } });

            await authUser(req, res, next);
            expect(req.user).toBeDefined();
            expect(next).toHaveBeenCalled();
        });
    });

    describe('authCaptain', () => {
        it('should return 401 if token is blacklisted', async () => {
            req.headers.authorization = 'Bearer testtoken';
            blackListTokenModel.findOne.mockResolvedValue({ token: 'testtoken' });

            await authCaptain(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('should call next and populate req.captain if token is valid', async () => {
            req.headers.authorization = 'Bearer testtoken';
            blackListTokenModel.findOne.mockResolvedValue(null);
            jwt.verify.mockReturnValue({ _id: 'captainid' });
            captainService.getCaptainProfile.mockResolvedValue({ _id: 'captainid', fullname: { firstname: 'Cap' } });

            await authCaptain(req, res, next);
            expect(req.captain).toBeDefined();
            expect(next).toHaveBeenCalled();
        });
    });

    describe('authBoth', () => {
        it('should allow user', async () => {
            req.headers.authorization = 'Bearer testtoken';
            blackListTokenModel.findOne.mockResolvedValue(null);
            jwt.verify.mockReturnValue({ _id: 'userid' });
            userService.getUserProfile.mockResolvedValue({ _id: 'userid' });
            
            await authBoth(req, res, next);
            expect(req.user).toBeDefined();
            expect(next).toHaveBeenCalled();
        });

        it('should allow captain if user not found', async () => {
            req.headers.authorization = 'Bearer testtoken';
            blackListTokenModel.findOne.mockResolvedValue(null);
            jwt.verify.mockReturnValue({ _id: 'captainid' });
            userService.getUserProfile.mockResolvedValue(null);
            captainService.getCaptainProfile.mockResolvedValue({ _id: 'captainid' });
            
            await authBoth(req, res, next);
            expect(req.captain).toBeDefined();
            expect(next).toHaveBeenCalled();
        });
    });
});
