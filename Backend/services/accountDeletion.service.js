const crypto = require('crypto');
const cron = require('node-cron');

const accountDeletionRequestModel = require('../models/accountDeletionRequest.model');
const blackListTokenModel = require('../models/blacklistToken.model');
const captainModel = require('../models/captain.model');
const chatModel = require('../models/chat.model');
const messageModel = require('../models/message.model');
const notificationModel = require('../models/notification.model');
const notificationTokenModel = require('../models/notificationToken.model');
const parcelModel = require('../models/parcel.model');
const rechargeModel = require('../models/recharge.model');
const reviewModel = require('../models/review.model');
const rideModel = require('../models/ride.model');
const supportTicketModel = require('../models/supportTicket.model');
const payoutModel = require('../models/payout.model');
const userModel = require('../models/user.model');
const authService = require('./auth.service');
const uploadService = require('./upload.service');
const { deleteByPrefix } = require('../cache/cache');

const RETENTION_DAYS = 30;
const ACTIVE_RIDE_STATUSES = [
    'scheduled', 'requested', 'accepted', 'going_to_pickup', 'arrived',
    'waiting_passenger', 'started',
];
const ACTIVE_PARCEL_STATUSES = [
    'scheduled', 'awaiting_provider', 'provider_accepted', 'going_to_pickup',
    'arrived_pickup', 'collected', 'in_transit', 'arrived_destination', 'delivered',
];

function serviceError(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function processDate(from = new Date()) {
    return new Date(from.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

async function assertNoActiveService({ accountId, accountType }) {
    const ownerField = accountType === 'captain' ? 'captain' : 'user';
    const [ride, parcel] = await Promise.all([
        rideModel.exists({ [ownerField]: accountId, status: { $in: ACTIVE_RIDE_STATUSES } }),
        parcelModel.exists({ [ownerField]: accountId, status: { $in: ACTIVE_PARCEL_STATUSES } }),
    ]);

    if (ride || parcel) {
        throw serviceError(
            'Finalize ou cancele a corrida/encomenda ativa antes de solicitar a exclusão.',
            409,
            'ACTIVE_SERVICE'
        );
    }
}

async function findOpenRequest({ accountId, email, accountType }) {
    const owner = accountId ? { accountId } : { email: normalizeEmail(email) };
    return accountDeletionRequestModel.findOne({
        ...owner,
        accountType,
        status: { $in: ['pending_verification', 'scheduled', 'processing'] },
    }).sort({ requestedAt: -1 });
}

async function scheduleAuthenticated({ account, accountType, accessToken, verifiedBy = null, source = 'authenticated' }) {
    await assertNoActiveService({ accountId: account._id, accountType });

    const now = new Date();
    let request = await findOpenRequest({ accountId: account._id, accountType });
    if (!request) {
        request = new accountDeletionRequestModel({
            accountType,
            accountId: account._id,
            email: normalizeEmail(account.email),
            source,
            status: 'scheduled',
            requestedAt: now,
            processAfter: processDate(now),
            verifiedBy,
        });
    } else {
        request.accountId = account._id;
        request.email = normalizeEmail(account.email);
        request.status = 'scheduled';
        request.processAfter = request.processAfter || processDate(now);
        request.verifiedBy = verifiedBy || request.verifiedBy;
        request.failureReason = '';
    }

    if (accountType === 'captain') {
        await captainModel.updateOne({ _id: account._id }, {
            $set: {
                isBlocked: true,
                canReceiveRides: false,
                isOnline: false,
                status: 'inactive',
                busyLock: false,
                socketId: null,
                onlineSince: null,
                approvalStatus: 'bloqueado',
            },
        });
        deleteByPrefix(`profile:captain:${account._id}`);
    } else {
        await userModel.updateOne({ _id: account._id }, {
            $set: { isBlocked: true, socketId: null },
        });
        deleteByPrefix(`profile:user:${account._id}`);
    }

    await Promise.all([
        request.save(),
        authService.revokeAllForUser({ userId: account._id, userType: accountType, reason: 'account_deletion' }),
        notificationTokenModel.deleteMany(accountType === 'captain'
            ? { captainId: account._id }
            : { userId: account._id }),
        accessToken ? blackListTokenModel.create({ token: accessToken }).catch(() => {}) : Promise.resolve(),
    ]);

    return request;
}

async function requestAuthenticated({ account, accountType, confirmation, accessToken }) {
    if (String(confirmation || '').trim().toUpperCase() !== 'EXCLUIR') {
        throw serviceError('Digite EXCLUIR para confirmar.', 400, 'CONFIRMATION_REQUIRED');
    }
    return scheduleAuthenticated({ account, accountType, accessToken });
}

async function requestPublic({ email, accountType }) {
    const normalizedEmail = normalizeEmail(email);
    const existing = await findOpenRequest({ email: normalizedEmail, accountType });
    if (!existing) {
        await accountDeletionRequestModel.create({
            accountType,
            email: normalizedEmail,
            source: 'web',
            status: 'pending_verification',
            requestedAt: new Date(),
        });
    }
}

async function approvePublicRequest({ requestId, adminId }) {
    const request = await accountDeletionRequestModel.findOne({
        _id: requestId,
        status: 'pending_verification',
    });
    if (!request) {
        throw serviceError('Solicitação pendente não encontrada.', 404, 'REQUEST_NOT_FOUND');
    }

    const model = request.accountType === 'captain' ? captainModel : userModel;
    const account = await model.findOne({ email: request.email });
    if (!account) {
        request.status = 'rejected';
        request.failureReason = 'Conta não localizada após verificação do suporte.';
        request.verifiedBy = adminId;
        await request.save();
        return request;
    }

    request.accountId = account._id;
    request.verifiedBy = adminId;
    await request.save();

    return scheduleAuthenticated({
        account,
        accountType: request.accountType,
        verifiedBy: adminId,
        source: 'web',
    });
}

async function removeImages(urls) {
    await Promise.all((urls || []).filter(Boolean).map(url => uploadService.deleteImageStrict(url)));
}

async function deleteConversationData({ accountId, accountType }) {
    const query = accountType === 'captain' ? { captainId: accountId } : { passengerId: accountId };
    const chats = await chatModel.find(query).select('_id');
    const chatIds = chats.map(chat => chat._id);
    if (chatIds.length) {
        const imageMessages = await messageModel.find({ chatId: { $in: chatIds }, type: 'image' }).select('message');
        await removeImages(imageMessages.map(item => item.message));
        await messageModel.deleteMany({ chatId: { $in: chatIds } });
        await chatModel.deleteMany({ _id: { $in: chatIds } });
    }
}

async function anonymizeUser(user) {
    const parcels = await parcelModel.find({ user: user._id }).select('photos');
    await removeImages([
        user.profilePicture,
        ...parcels.flatMap(parcel => [parcel.photos?.pickupUrl, parcel.photos?.deliveryUrl]),
    ]);
    const anonymousEmail = `deleted+user-${user._id}@deleted.movecity.invalid`;
    const password = await userModel.hashPassword(crypto.randomBytes(32).toString('hex'));

    await Promise.all([
        userModel.updateOne({ _id: user._id }, {
            $set: {
                'fullname.firstname': 'Conta',
                'fullname.lastname': 'Removida',
                email: anonymousEmail,
                password,
                profilePicture: '',
                socketId: null,
                city: '',
                gender: '',
                tags: [],
                observations: [],
                isBlocked: true,
            },
            $unset: { cpf: '', phone: '', birthDate: '' },
        }),
        rideModel.updateMany({ user: user._id }, {
            $set: { pickup: 'Endereço removido', destination: 'Endereço removido' },
            $unset: { pickupCoordinates: '', destinationCoordinates: '', origin: '', destinationMeta: '', adminPassenger: '' },
        }),
        parcelModel.updateMany({ user: user._id }, {
            $set: {
                pickup: 'Endereço removido',
                destination: 'Endereço removido',
                sender: { name: 'Removido', phone: 'Removido' },
                recipient: { name: 'Removido', phone: 'Removido' },
                description: '',
                notes: '',
                photos: { pickupUrl: null, deliveryUrl: null },
            },
            $unset: { pickupCoordinates: '', destinationCoordinates: '', deliveryPin: '' },
        }),
        notificationModel.deleteMany({ userId: user._id }),
        notificationTokenModel.deleteMany({ userId: user._id }),
        supportTicketModel.deleteMany({ user: user._id }),
        reviewModel.updateMany({ user: user._id }, { $unset: { comment: '' } }),
        deleteConversationData({ accountId: user._id, accountType: 'user' }),
    ]);
}

function captainDocumentUrls(captain) {
    return ['cnhFront', 'cnhBack', 'crlv', 'vehicleFront', 'selfie']
        .map(type => captain.documents?.[type]?.url)
        .filter(Boolean);
}

async function anonymizeCaptain(captain) {
    const parcels = await parcelModel.find({ captain: captain._id }).select('photos');
    await removeImages([
        captain.profilePicture,
        ...captainDocumentUrls(captain),
        ...parcels.flatMap(parcel => [parcel.photos?.pickupUrl, parcel.photos?.deliveryUrl]),
    ]);
    const anonymousEmail = `deleted+captain-${captain._id}@deleted.movecity.invalid`;
    const password = await captainModel.hashPassword(crypto.randomBytes(32).toString('hex'));
    const emptyDocument = { url: '', verified: false, reason: '', uploadedAt: null };

    await Promise.all([
        captainModel.updateOne({ _id: captain._id }, {
            $set: {
                'fullname.firstname': 'Conta',
                'fullname.lastname': 'Removida',
                email: anonymousEmail,
                password,
                profilePicture: '',
                socketId: null,
                documents: {
                    cnhFront: emptyDocument,
                    cnhBack: emptyDocument,
                    crlv: emptyDocument,
                    vehicleFront: emptyDocument,
                    selfie: emptyDocument,
                },
                cnh: {},
                pix: {},
                bankDetails: {},
                'vehicle.marca': 'Removida',
                'vehicle.modelo': 'Removido',
                'vehicle.ano': 2000,
                'vehicle.color': 'N/A',
                'vehicle.plate': `DEL${String(captain._id).slice(-4).toUpperCase()}`,
                location: {},
                locationGeoJSON: { type: 'Point', coordinates: [0, 0] },
                isBlocked: true,
                approvalStatus: 'bloqueado',
                canReceiveRides: false,
                status: 'inactive',
                isOnline: false,
                busyLock: false,
                onlineSince: null,
            },
            $unset: { cpf: '', phone: '', birthDate: '' },
        }),
        notificationModel.deleteMany({ captainId: captain._id }),
        notificationTokenModel.deleteMany({ captainId: captain._id }),
        reviewModel.updateMany({ captain: captain._id }, { $unset: { comment: '' } }),
        rechargeModel.updateMany({ captainId: captain._id }, { $unset: { qrCode: '', pixCopyPaste: '' } }),
        payoutModel.updateMany({ captainId: captain._id }, { $set: { bankDetailsSnapshot: {} } }),
        parcelModel.updateMany({ captain: captain._id }, { $set: { photos: { pickupUrl: null, deliveryUrl: null } } }),
        deleteConversationData({ accountId: captain._id, accountType: 'captain' }),
    ]);
}

async function processRequest(request) {
    const locked = await accountDeletionRequestModel.findOneAndUpdate(
        { _id: request._id, status: 'scheduled', processAfter: { $lte: new Date() } },
        { $set: { status: 'processing', failureReason: '' } },
        { new: true }
    );
    if (!locked) return false;

    try {
        const model = locked.accountType === 'captain' ? captainModel : userModel;
        const account = await model.findById(locked.accountId);
        if (account) {
            // Rede de segurança contra uma corrida criada em concorrência entre a
            // checagem inicial e o bloqueio da conta. Nunca anonimiza um serviço ativo.
            await assertNoActiveService({ accountId: account._id, accountType: locked.accountType });
            if (locked.accountType === 'captain') await anonymizeCaptain(account);
            else await anonymizeUser(account);
        }

        locked.status = 'completed';
        locked.completedAt = new Date();
        locked.email = `deleted+request-${locked._id}@deleted.movecity.invalid`;
        locked.failureReason = '';
        await locked.save();
        return true;
    } catch (error) {
        locked.status = 'scheduled';
        locked.failureReason = String(error.message || error).slice(0, 500);
        await locked.save();
        throw error;
    }
}

async function processDueRequests() {
    const stalePublicCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const stalePublicRequests = await accountDeletionRequestModel.find({
        status: 'pending_verification',
        requestedAt: { $lte: stalePublicCutoff },
    }).select('_id');
    for (const stale of stalePublicRequests) {
        await accountDeletionRequestModel.updateOne({ _id: stale._id, status: 'pending_verification' }, {
            $set: {
                status: 'rejected',
                email: `deleted+request-${stale._id}@deleted.movecity.invalid`,
                failureReason: 'Solicitação expirada sem verificação de identidade.',
            },
        });
    }

    const requests = await accountDeletionRequestModel.find({
        status: 'scheduled',
        processAfter: { $lte: new Date() },
    }).limit(100);

    let completed = 0;
    for (const request of requests) {
        if (await processRequest(request)) completed++;
    }
    return completed;
}

if (process.env.NODE_ENV !== 'test') {
    cron.schedule('17 * * * *', () => {
        processDueRequests().catch(error => console.error('[AccountDeletion] Erro no processamento:', error));
    });
}

module.exports = {
    RETENTION_DAYS,
    ACTIVE_RIDE_STATUSES,
    ACTIVE_PARCEL_STATUSES,
    requestAuthenticated,
    requestPublic,
    approvePublicRequest,
    processDueRequests,
    processRequest,
};
