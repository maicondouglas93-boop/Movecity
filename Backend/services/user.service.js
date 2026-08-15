const mongoose = require('mongoose');
const userModel = require('../models/user.model');
const { getCache, setCache, deleteCache } = require('../cache/cache');
const { normalizeEmail } = require('../utils/googleIdentity');

const normalizePhone = (phone) => {
    if (phone == null || phone === '') return null;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
    if (digits.length >= 10 && digits.length <= 11) return `+55${digits}`;
    return `+${digits}`;
};

const normalizeCpf = (cpf) => {
    if (cpf == null || cpf === '') return null;
    const digits = String(cpf).replace(/\D/g, '');
    return digits || null;
};

module.exports.createUser = async ({
    firstname, lastname, email, password, profilePicture, cpf, phone, firebaseUid
}) => {
    const normalizedEmail = normalizeEmail(email);
    if (!firstname || !normalizedEmail || !password) {
        throw new Error('All fields are required');
    }
    const user = userModel.create({
        fullname: {
            firstname,
            lastname
        },
        email: normalizedEmail,
        password,
        profilePicture,
        cpf,
        phone,
        firebaseUid,
    })

    return user;
}

module.exports.findUserByNormalizedEmail = async (email, selectFields = '') => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;

    const query = userModel
        .findOne({ email: normalizedEmail })
        .collation({ locale: 'en', strength: 2 });
    if (selectFields) query.select(selectFields);
    return query;
};

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

// Atualização de dados pessoais do passageiro (2026-08-04): a tela PersonalData.jsx
// chamava PUT /users/profile, mas a rota nunca existiu — o catch do frontend fingia
// sucesso com "Modo Offline - API não encontrada".
module.exports.updateUserProfile = async (userId, payload = {}) => {
    if (!userId) throw new Error('User id is required');

    const user = await userModel.findById(userId);
    if (!user) throw new Error('User not found');

    if (payload.firstname != null && String(payload.firstname).trim()) {
        user.fullname.firstname = String(payload.firstname).trim();
    }
    if (payload.lastname != null) {
        user.fullname.lastname = String(payload.lastname).trim();
    }

    if (payload.phone !== undefined) {
        const phone = normalizePhone(payload.phone);
        if (phone === null) {
            user.phone = undefined;
        } else if (!/^\+\d{10,15}$/.test(phone)) {
            const err = new Error('Telefone inválido. Use DDD + número.');
            err.code = 'VALIDATION';
            throw err;
        } else {
            user.phone = phone;
        }
    }

    if (payload.cpf !== undefined) {
        const cpf = normalizeCpf(payload.cpf);
        if (cpf === null) {
            user.cpf = undefined;
        } else if (!/^\d{11}$/.test(cpf)) {
            const err = new Error('CPF inválido. Informe 11 dígitos.');
            err.code = 'VALIDATION';
            throw err;
        } else {
            const taken = await userModel.findOne({ cpf, _id: { $ne: userId } }).select('_id');
            if (taken) {
                const err = new Error('Este CPF já está em uso por outra conta.');
                err.code = 'CONFLICT';
                throw err;
            }
            user.cpf = cpf;
        }
    }

    if (payload.birthDate !== undefined) {
        if (!payload.birthDate) {
            user.birthDate = undefined;
        } else {
            const date = new Date(payload.birthDate);
            if (Number.isNaN(date.getTime())) {
                const err = new Error('Data de nascimento inválida.');
                err.code = 'VALIDATION';
                throw err;
            }
            user.birthDate = date;
        }
    }

    if (payload.gender !== undefined) {
        const allowed = [ 'male', 'female', 'other', '' ];
        const gender = payload.gender == null ? '' : String(payload.gender);
        if (!allowed.includes(gender)) {
            const err = new Error('Gênero inválido.');
            err.code = 'VALIDATION';
            throw err;
        }
        user.gender = gender;
    }

    await user.save();
    deleteCache(`profile:user:${userId}`);
    return user;
};
