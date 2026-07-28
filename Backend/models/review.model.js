const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    ride: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    captain: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        trim: true
    },
    type: {
        type: String,
        enum: ['passenger_to_driver', 'driver_to_passenger'],
        default: 'passenger_to_driver'
    },
    issueCategory: {
        type: String,
        enum: ['none', 'delay', 'behavior', 'vehicle_cleanliness', 'overcharge'],
        default: 'none'
    }
}, { timestamps: true });

module.exports = mongoose.model('review', reviewSchema);
