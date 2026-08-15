const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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
    const { generateAccessToken } = require('../services/auth.service');
    return generateAccessToken(this._id, 'admin', { role: this.role });
};

adminUserSchema.methods.generateRefreshToken = function() {
    throw new Error('Use authService.issueTokenPair: refresh tokens são opacos e persistidos por hash');
};

const adminUserModel = mongoose.model('AdminUser', adminUserSchema);

module.exports = adminUserModel;
