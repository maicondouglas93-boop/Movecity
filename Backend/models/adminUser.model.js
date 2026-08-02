const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const adminUserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        minlength: [3, 'Name must be at least 3 characters long'],
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
        type: String,
        required: true,
        select: false,
    },
    role: {
        type: String,
        enum: ['super_admin', 'financeiro', 'suporte', 'operador', 'OWNER'],
        default: 'suporte',
    },
    refreshToken: {
        type: String,
        select: false,
    },
    active: {
        type: Boolean,
        default: true,
    }
}, { timestamps: true });

// Hash password before saving
adminUserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

adminUserSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

adminUserSchema.methods.generateAuthToken = function() {
    const token = jwt.sign({ _id: this._id, role: this.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    return token;
};

adminUserSchema.methods.generateRefreshToken = function() {
    // jti garante um token diferente a cada chamada mesmo dentro do mesmo segundo (o
    // "iat" do JWT só tem granularidade de segundo) — sem isso, duas rotações rápidas
    // gerariam o mesmo token e a rotação não teria efeito nenhum.
    const token = jwt.sign({ _id: this._id, jti: crypto.randomUUID() }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return token;
};

const adminUserModel = mongoose.model('AdminUser', adminUserSchema);

module.exports = adminUserModel;
