const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');


const userSchema = new mongoose.Schema({
    fullname: {
        firstname: {
            type: String,
            required: true,
            minlength: [ 3, 'First name must be at least 3 characters long' ],
        },
        lastname: {
            type: String,
            minlength: [ 3, 'Last name must be at least 3 characters long' ],
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
        required: true,
        match: [ /^\+\d{10,15}$/, 'Please enter a valid E.164 phone number (e.g. +5511999999999)' ]
    },
    isBlocked: {
        type: Boolean,
        default: false,
    },
    rating: {
        type: Number,
        default: 5.0,
    },
}, { timestamps: true });

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