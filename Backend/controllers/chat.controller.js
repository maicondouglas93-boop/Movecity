const chatService = require('../services/chat.service');
const { validationResult } = require('express-validator');

const rateLimitCache = {};

const checkRateLimit = (userId) => {
    const now = Date.now();
    if (!rateLimitCache[userId]) {
        rateLimitCache[userId] = [];
    }
    rateLimitCache[userId] = rateLimitCache[userId].filter(timestamp => now - timestamp < 1000);

    if (rateLimitCache[userId].length >= 5) {
        return false;
    }

    rateLimitCache[userId].push(now);
    return true;
};

function subjectFromReq(req) {
    const subjectType = req.body?.subjectType || req.query?.subjectType || req.params?.subjectType || 'ride';
    const subjectId = req.body?.subjectId || req.params?.subjectId || req.params?.rideId || req.body?.rideId;
    const rideId = req.body?.rideId || (subjectType === 'ride' ? subjectId : undefined);
    return { subjectType, subjectId, rideId };
}

module.exports.getChat = async (req, res) => {
    try {
        const subjectInput = {
            subjectType: req.query.subjectType || (req.params.subjectType) || 'ride',
            subjectId: req.params.subjectId || req.params.rideId,
            rideId: req.params.rideId,
        };
        const userOrCaptain = req.user || req.captain;

        const subject = await chatService.resolveSubject(subjectInput);
        chatService.assertParticipant(subject, userOrCaptain._id);

        const chat = await chatService.getOrCreateChat(subjectInput);
        const messages = await chatService.getChatMessages(chat._id);

        res.status(200).json({ chat, messages, subjectType: subject.subjectType, subjectId: subject.subjectId });
    } catch (err) {
        if (err.message === 'SUBJECT_NOT_FOUND') return res.status(404).json({ message: 'Chat subject not found' });
        if (err.message === 'CHAT_UNAUTHORIZED') return res.status(403).json({ message: 'Unauthorized access to this chat' });
        if (err.message === 'CHAT_NO_CAPTAIN') return res.status(400).json({ message: 'Chat unavailable until a provider is assigned' });
        console.error('Error fetching chat:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports.sendMessage = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const subjectInput = subjectFromReq(req);
        const { message, type, operationalType } = req.body;
        const userOrCaptain = req.user || req.captain;
        const senderType = req.user ? 'user' : 'captain';

        if (!checkRateLimit(userOrCaptain._id.toString())) {
            return res.status(429).json({ message: 'Too many messages sent. Please slow down.' });
        }

        const subject = await chatService.resolveSubject(subjectInput);
        chatService.assertParticipant(subject, userOrCaptain._id);

        if (!subject.isChatActive) {
            return res.status(400).json({ message: 'Cannot send message. Chat subject is not active.' });
        }

        let messageToPersist = message;
        if (operationalType === 'delivery_pin') {
            if (subject.subjectType !== 'parcel' || senderType !== 'user' || !subject.doc.deliveryPin) {
                return res.status(400).json({ message: 'Invalid operational PIN message.' });
            }
            // O valor operacional vem do banco, não do texto controlado pelo cliente.
            messageToPersist = `PIN da entrega: ${subject.doc.deliveryPin}`;
        }

        const sanitizedMessage = messageToPersist.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const badWords = ['palavrao1', 'palavrao2'];
        const isProfane = badWords.some(word => sanitizedMessage.toLowerCase().includes(word));
        if (isProfane) {
            return res.status(400).json({ message: 'Message contains prohibited content.' });
        }

        const chat = await chatService.getOrCreateChat(subjectInput);
        const recipientType = senderType === 'user' ? 'captain' : 'user';
        const recipientId = recipientType === 'captain' ? subject.captainId : subject.userId;

        const newMessage = await chatService.saveMessage({
            chatId: chat._id,
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
            rideId: subject.subjectType === 'ride' ? subject.subjectId : undefined,
            senderId: userOrCaptain._id,
            senderType,
            recipientId,
            recipientType,
            message: sanitizedMessage,
            type,
            operationalType,
        });

        try {
            const { publishPersistedChatMessage } = require('../socket');
            await publishPersistedChatMessage({
                subject,
                message: newMessage,
                senderType,
            });
        } catch (deliveryError) {
            // Persistência já confirmou sucesso. Histórico recupera a mensagem mesmo
            // se Socket.IO/FCM estiver temporariamente indisponível.
            console.error('[Chat] Mensagem persistida; falha no realtime/push:', deliveryError.message);
        }

        res.status(201).json(newMessage);
    } catch (err) {
        if (err.message === 'SUBJECT_NOT_FOUND') return res.status(404).json({ message: 'Chat subject not found' });
        if (err.message === 'CHAT_UNAUTHORIZED') return res.status(403).json({ message: 'Unauthorized access to this chat' });
        if (err.message === 'CHAT_NO_CAPTAIN') return res.status(400).json({ message: 'Chat unavailable until a provider is assigned' });
        console.error('Error sending message:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports.markRead = async (req, res) => {
    try {
        const subjectInput = subjectFromReq(req);
        const userOrCaptain = req.user || req.captain;
        const readerType = req.user ? 'user' : 'captain';

        const subject = await chatService.resolveSubject(subjectInput);
        chatService.assertParticipant(subject, userOrCaptain._id);

        const chat = await chatService.getOrCreateChat(subjectInput);
        await chatService.markAsRead(chat._id, readerType);

        res.status(200).json({ message: 'Messages marked as read' });
    } catch (err) {
        if (err.message === 'SUBJECT_NOT_FOUND') return res.status(404).json({ message: 'Chat subject not found' });
        if (err.message === 'CHAT_UNAUTHORIZED') return res.status(403).json({ message: 'Unauthorized access to this chat' });
        console.error('Error marking messages as read:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};
