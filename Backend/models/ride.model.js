const mongoose = require('mongoose');


const rideSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    captain: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
    },
    pickup: {
        type: String,
        required: true,
    },
    destination: {
        type: String,
        required: true,
    },
    fare: {
        type: Number,
        required: true,
    },
    vehicleType: {
        type: String,
        required: true,
        enum: [ 'auto', 'car', 'moto' ]
    },

    status: {
        type: String,
        enum: [ 'requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'finished', 'cancelled' ],
        default: 'requested',
    },

    duration: {
        type: Number, // Deprecated, but keeping for compatibility if needed. Better to use estimatedTime/actualTime
    }, 
    distance: {
        type: Number, // Deprecated, keeping for compatibility
    },

    estimatedDistance: {
        type: Number, // meters
    },
    estimatedTime: {
        type: Number, // seconds
    },
    estimatedPriceMin: {
        type: Number,
    },
    estimatedPriceMax: {
        type: Number,
    },
    actualDistance: {
        type: Number,
        default: 0
    },
    lastLocation: {
        lat: Number,
        lng: Number
    },
    actualTime: {
        type: Number,
    },
    finalPrice: {
        type: Number,
    },
    commissionPercent: {
        type: Number,
    },
    commissionAmount: {
        type: Number,
    },

    paymentID: {
        type: String,
    },
    paymentStatus: {
        type: String,
        enum: [ 'pending', 'completed', 'refunded' ],
        default: 'pending',
    },
    paymentMethod: {
        type: String,
        enum: [ 'card', 'cash', 'upi', 'wallet', 'pix' ],
        default: 'cash',
    },
    orderId: {
        type: String,
    },
    signature: {
        type: String,
    },

    otp: {
        type: String,
        select: false,
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model('ride', rideSchema);