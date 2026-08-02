const mongoose = require('mongoose');
const userModel = require('../models/user.model');
const { getCache, setCache } = require('../cache/cache');

module.exports.createUser = async ({
    firstname, lastname, email, password, profilePicture, cpf, phone
}) => {
    if (!firstname || !email || !password) {
        throw new Error('All fields are required');
    }
    const user = userModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password,
        profilePicture,
        cpf,
        phone
    })

    return user;
}

// Espelha captainService.recalculateRating — auditoria de UX do motorista
// (2026-08-02, Etapa 7): o schema de review já suportava 'driver_to_passenger' desde
// sempre, mas nada no backend criava esse tipo de avaliação nem recalculava a nota do
// passageiro a partir dela. O motorista nunca tinha como avaliar quem andou com ele.
module.exports.recalculateRating = async (userId) => {
    const reviewModel = require('../models/review.model');
    const [stats] = await reviewModel.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId), type: 'driver_to_passenger' } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);

    if (stats && stats.count > 0) {
        const rating = Math.round(stats.avg * 10) / 10;
        await userModel.findByIdAndUpdate(userId, { rating });
        return rating;
    }
    return null;
};

module.exports.getUserProfile = async (id) => {
    const cacheKey = `profile:user:${id}`;
    const cachedUser = getCache(cacheKey);
    
    if (cachedUser) {
        return cachedUser;
    }
    
    const user = await userModel.findById(id);
    if (user) {
        setCache(cacheKey, user, 600); // 10 minutos
    }
    
    return user;
}