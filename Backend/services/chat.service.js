const chatModel = require('../models/chat.model');
const messageModel = require('../models/message.model');
const rideModel = require('../models/ride.model');

module.exports.getOrCreateChat = async (rideId) => {
    let chat = await chatModel.findOne({ rideId }).populate('lastMessage');
    
    if (!chat) {
        const ride = await rideModel.findById(rideId);
        if (!ride) throw new Error('Ride not found');
        
        chat = await chatModel.create({
            rideId,
            passengerId: ride.user,
            captainId: ride.captain
        });
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
    const { chatId, rideId, senderId, senderType, message, type } = data;
    
    const newMessage = await messageModel.create({
        chatId,
        rideId,
        senderId,
        senderType,
        message,
        type: type || 'text'
    });

    // Update the chat with the last message and increment unread counts
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

    // Update messages status to read where sender is NOT the reader
    const senderType = readerType === 'user' ? 'captain' : 'user';
    await messageModel.updateMany(
        { chatId, senderType, status: { $ne: 'read' } },
        { $set: { status: 'read' } }
    );
};
