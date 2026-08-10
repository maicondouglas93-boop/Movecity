const chatModel = require('../models/chat.model');
const messageModel = require('../models/message.model');
const rideModel = require('../models/ride.model');
const parcelModel = require('../models/parcel.model');

const RIDE_CHAT_STATUSES = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing'];
const PARCEL_CHAT_STATUSES = [
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
];

function normalizeSubject({ subjectType, subjectId, rideId } = {}) {
    const type = subjectType === 'parcel' ? 'parcel' : 'ride';
    const id = subjectId || rideId;
    if (!id) throw new Error('SUBJECT_ID_REQUIRED');
    return { subjectType: type, subjectId: id };
}

module.exports.normalizeSubject = normalizeSubject;
module.exports.RIDE_CHAT_STATUSES = RIDE_CHAT_STATUSES;
module.exports.PARCEL_CHAT_STATUSES = PARCEL_CHAT_STATUSES;

module.exports.resolveSubject = async ({ subjectType, subjectId, rideId } = {}) => {
    const normalized = normalizeSubject({ subjectType, subjectId, rideId });

    if (normalized.subjectType === 'parcel') {
        const parcel = await parcelModel.findById(normalized.subjectId).select('+deliveryPin');
        if (!parcel) throw new Error('SUBJECT_NOT_FOUND');
        return {
            ...normalized,
            userId: parcel.user,
            captainId: parcel.captain,
            status: parcel.status,
            isChatActive: PARCEL_CHAT_STATUSES.includes(parcel.status),
            doc: parcel,
        };
    }

    const ride = await rideModel.findById(normalized.subjectId).select('+otp');
    if (!ride) throw new Error('SUBJECT_NOT_FOUND');
    return {
        ...normalized,
        userId: ride.user,
        captainId: ride.captain,
        status: ride.status,
        isChatActive: RIDE_CHAT_STATUSES.includes(ride.status),
        doc: ride,
    };
};

module.exports.assertParticipant = (subject, userOrCaptainId) => {
    const uid = userOrCaptainId?.toString?.() || String(userOrCaptainId);
    const userOk = subject.userId && subject.userId.toString() === uid;
    const captainOk = subject.captainId && subject.captainId.toString() === uid;
    if (!userOk && !captainOk) throw new Error('CHAT_UNAUTHORIZED');
};

module.exports.getOrCreateChat = async ({ subjectType, subjectId, rideId } = {}) => {
    const subject = await module.exports.resolveSubject({ subjectType, subjectId, rideId });
    if (!subject.captainId) throw new Error('CHAT_NO_CAPTAIN');

    let chat = await chatModel.findOne({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
    }).populate('lastMessage');

    // Compat: chats de corrida criados só com rideId
    if (!chat && subject.subjectType === 'ride') {
        chat = await chatModel.findOne({ rideId: subject.subjectId }).populate('lastMessage');
        if (chat && (!chat.subjectId || !chat.subjectType)) {
            chat.subjectType = 'ride';
            chat.subjectId = subject.subjectId;
            await chat.save();
        }
    }

    if (!chat) {
        // Upsert atômico em vez de find-then-create: duas requisições concorrentes
        // pro mesmo subject (ex.: abrir o chat e mandar uma mensagem ao mesmo
        // tempo) não colidem mais no índice único subjectType+subjectId. O
        // catch cobre a janela residual que upsert ainda pode deixar sob
        // corrida real — sem isso a 2ª chamada lançava E11000 sem tratamento,
        // virando 500 pro cliente (reproduzido isoladamente, 2026-08-10).
        try {
            chat = await chatModel.findOneAndUpdate(
                { subjectType: subject.subjectType, subjectId: subject.subjectId },
                {
                    $setOnInsert: {
                        rideId: subject.subjectType === 'ride' ? subject.subjectId : undefined,
                        passengerId: subject.userId,
                        captainId: subject.captainId,
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            );
        } catch (err) {
            if (err.code !== 11000) throw err;
            chat = await chatModel.findOne({
                subjectType: subject.subjectType,
                subjectId: subject.subjectId,
            }).populate('lastMessage');
        }
    } else if (
        chat.passengerId?.toString() !== subject.userId?.toString()
        || chat.captainId?.toString() !== subject.captainId?.toString()
    ) {
        // Um redespacho pode trocar o motorista depois que o chat foi criado. A
        // autorização usa o subject atual; mantenha os metadados persistidos alinhados.
        chat.passengerId = subject.userId;
        chat.captainId = subject.captainId;
        await chat.save();
    }

    return chat;
};

module.exports.getChatMessages = async (chatId, limit = 50, skip = 0) => {
    return await messageModel.find({ chatId })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit);
};

module.exports.saveMessage = async (data) => {
    const {
        chatId,
        subjectType,
        subjectId,
        rideId,
        senderId,
        senderType,
        recipientId,
        recipientType,
        message,
        type,
        operationalType,
    } = data;
    const normalized = normalizeSubject({ subjectType, subjectId, rideId });

    const newMessage = await messageModel.create({
        chatId,
        subjectType: normalized.subjectType,
        subjectId: normalized.subjectId,
        rideId: normalized.subjectType === 'ride' ? normalized.subjectId : undefined,
        senderId,
        senderType,
        recipientId,
        recipientType,
        message,
        type: type || 'text',
        operationalType: operationalType || null,
    });

    const updateData = { lastMessage: newMessage._id };
    if (senderType === 'user') {
        updateData.$inc = { unreadCaptain: 1 };
    } else if (senderType === 'captain') {
        updateData.$inc = { unreadUser: 1 };
    }

    await chatModel.findByIdAndUpdate(chatId, updateData);

    return newMessage;
};

module.exports.markAsRead = async (chatId, readerType) => {
    const updateField = readerType === 'user' ? { unreadUser: 0 } : { unreadCaptain: 0 };
    await chatModel.findByIdAndUpdate(chatId, updateField);

    const senderType = readerType === 'user' ? 'captain' : 'user';
    await messageModel.updateMany(
        { chatId, senderType, status: { $ne: 'read' } },
        { $set: { status: 'read' } }
    );
};
