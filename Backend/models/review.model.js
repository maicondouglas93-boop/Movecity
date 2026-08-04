const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    subjectType: {
        type: String,
        enum: ['ride', 'parcel'],
        default: 'ride',
        index: true,
    },
    subjectId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    // Compat: reviews de corrida antigas usavam só `ride`
    ride: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        sparse: true,
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

reviewSchema.index({ subjectType: 1, subjectId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('review', reviewSchema);
