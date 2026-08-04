const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');


const userSchema = new mongoose.Schema({
    fullname: {
        firstname: {
            type: String,
            required: true,
            minlength: [ 1, 'First name must be at least 1 character long' ],
        },
        lastname: {
            type: String,
        }
    },
    email: {
        type: String,
        required: true,
        unique: true,
        minlength: [ 5, 'Email must be at least 5 characters long' ],
    },
    profilePicture: {
        type: String,
        default: '',
    },
    walletBalance: {
        type: Number,
        default: 0,
    },
    cpf: {
        type: String,
        unique: true,
        sparse: true, // Allows null/missing for legacy users
        match: [ /^\d{11}$/, 'Please enter a valid 11-digit CPF' ]
    },
    password: {
        type: String,
        required: true,
        select: false,
    },
    socketId: {
        type: String,
    },
    phone: {
        type: String,
        match: [ /^\+\d{10,15}$/, 'Please enter a valid E.164 phone number (e.g. +5511999999999)' ]
    },
    birthDate: {
        type: Date,
    },
    gender: {
        type: String,
        enum: [ 'male', 'female', 'other', '' ],
        default: '',
    },
    isBlocked: {
        type: Boolean,
        default: false,
    },
    rating: {
        type: Number,
        default: 5.0,
    },
    // CRM Fields (Denormalized)
    totalRides: {
        type: Number,
        default: 0,
    },
    totalSpent: {
        type: Number,
        default: 0,
    },
    totalDistance: {
        type: Number,
        default: 0,
    },
    lastRideAt: {
        type: Date,
    },
    city: {
        type: String,
        default: '',
    },
    tags: [{
        type: String,
    }],
    observations: [{
        adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
        adminName: String,
        text: String,
        createdAt: { type: Date, default: Date.now }
    }],
}, { timestamps: true });

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ isBlocked: 1 });
userSchema.index({ city: 1 });
userSchema.index({ totalRides: -1 });

userSchema.methods.generateAuthToken = function () {
    const token = jwt.sign({ _id: this._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    return token;
}

userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
}

userSchema.statics.hashPassword = async function (password) {
    return await bcrypt.hash(password, 10);
}

const userModel = mongoose.model('user', userSchema);


module.exports = userModel;