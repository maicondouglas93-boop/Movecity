jest.mock('../../models/accountDeletionRequest.model', () => ({ findOne: jest.fn() }));
jest.mock('../../models/blacklistToken.model', () => ({ create: jest.fn() }));
jest.mock('../../models/captain.model', () => ({ updateOne: jest.fn(), findOne: jest.fn(), hashPassword: jest.fn() }));
jest.mock('../../models/chat.model', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../../models/message.model', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../../models/notification.model', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/notificationToken.model', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/parcel.model', () => ({ exists: jest.fn(), find: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../models/recharge.model', () => ({ updateMany: jest.fn() }));
jest.mock('../../models/review.model', () => ({ updateMany: jest.fn() }));
jest.mock('../../models/ride.model', () => ({ exists: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../models/supportTicket.model', () => ({ deleteMany: jest.fn() }));
jest.mock('../../models/payout.model', () => ({ updateMany: jest.fn() }));
jest.mock('../../models/user.model', () => ({ updateOne: jest.fn(), findOne: jest.fn(), hashPassword: jest.fn() }));
jest.mock('../../services/auth.service', () => ({ revokeAllForUser: jest.fn() }));
jest.mock('../../services/upload.service', () => ({ deleteImageStrict: jest.fn() }));
jest.mock('../../cache/cache', () => ({ deleteByPrefix: jest.fn(), clearCache: jest.fn() }));

const requestModel = require('../../models/accountDeletionRequest.model');
const blacklistModel = require('../../models/blacklistToken.model');
const notificationTokenModel = require('../../models/notificationToken.model');
const parcelModel = require('../../models/parcel.model');
const rideModel = require('../../models/ride.model');
const userModel = require('../../models/user.model');
const authService = require('../../services/auth.service');
const service = require('../../services/accountDeletion.service');

describe('accountDeletion.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rideModel.exists.mockResolvedValue(null);
        parcelModel.exists.mockResolvedValue(null);
        userModel.updateOne.mockResolvedValue({ acknowledged: true });
        notificationTokenModel.deleteMany.mockResolvedValue({ deletedCount: 1 });
        blacklistModel.create.mockResolvedValue({});
        authService.revokeAllForUser.mockResolvedValue();
    });

    test('exige confirmação explícita', async () => {
        await expect(service.requestAuthenticated({
            account: { _id: 'user-1', email: 'user@example.com' },
            accountType: 'user',
            confirmation: 'apagar',
        })).rejects.toMatchObject({ statusCode: 400, code: 'CONFIRMATION_REQUIRED' });
        expect(rideModel.exists).not.toHaveBeenCalled();
    });

    test('não desativa conta com corrida ativa', async () => {
        rideModel.exists.mockResolvedValue({ _id: 'ride-1' });
        await expect(service.requestAuthenticated({
            account: { _id: 'user-1', email: 'user@example.com' },
            accountType: 'user',
            confirmation: 'EXCLUIR',
        })).rejects.toMatchObject({ statusCode: 409, code: 'ACTIVE_SERVICE' });
        expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    test('bloqueia imediatamente, revoga sessões e preserva prazo existente', async () => {
        const existing = {
            accountId: 'user-1',
            email: 'user@example.com',
            status: 'scheduled',
            processAfter: new Date('2026-09-11T12:00:00.000Z'),
            save: jest.fn().mockResolvedValue(),
        };
        requestModel.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(existing) });

        const result = await service.requestAuthenticated({
            account: { _id: 'user-1', email: 'USER@EXAMPLE.COM' },
            accountType: 'user',
            confirmation: 'EXCLUIR',
            accessToken: 'access-token',
        });

        expect(result).toBe(existing);
        expect(userModel.updateOne).toHaveBeenCalledWith(
            { _id: 'user-1' },
            { $set: { isBlocked: true, socketId: null } }
        );
        expect(authService.revokeAllForUser).toHaveBeenCalledWith({
            userId: 'user-1', userType: 'user', reason: 'account_deletion',
        });
        expect(blacklistModel.create).toHaveBeenCalledWith({ token: 'access-token' });
        expect(existing.processAfter).toEqual(new Date('2026-09-11T12:00:00.000Z'));
    });
});
