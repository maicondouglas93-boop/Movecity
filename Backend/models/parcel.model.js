const mongoose = require('mongoose');

const personSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
}, { _id: false });

const parcelSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
    },
    captain: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
    },
    vehicleType: {
        type: String,
        enum: ['moto', 'car'],
        required: true,
    },
    pickup: { type: String, required: true },
    destination: { type: String, required: true },
    pickupCoordinates: {
        lat: Number,
        lng: Number,
    },
    destinationCoordinates: {
        lat: Number,
        lng: Number,
    },
    sender: { type: personSchema, required: true },
    recipient: { type: personSchema, required: true },
    itemName: { type: String, required: true, trim: true },
    category: {
        type: String,
        enum: ['documento', 'caixa', 'compras', 'comida', 'outros'],
        required: true,
    },
    weightKg: { type: Number, required: true, min: 0, max: 100 },
    size: {
        type: String,
        enum: ['small', 'medium', 'large'],
        required: true,
    },
    description: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    schedule: {
        mode: { type: String, enum: ['now', 'later'], default: 'now' },
        at: { type: Date, default: null },
    },
    scheduledAt: {
        type: Date,
        default: null,
        index: true,
    },
    // Momento scheduled → awaiting_provider (Fase 1 agendamento).
    activatedAt: {
        type: Date,
        default: null,
    },
    dispatchAttempts: {
        type: Number,
        default: 0,
    },
    dispatchLastError: {
        type: String,
        default: null,
    },
    fare: { type: Number, required: true },
    estimatedDistance: { type: Number }, // meters
    estimatedTime: { type: Number }, // seconds
    fareBreakdown: { type: Object },
    pricingSnapshot: { type: Object },
    deliveryPin: {
        type: String,
        select: false,
        required: true,
    },
    status: {
        type: String,
        enum: [
            'scheduled',
            'awaiting_provider',
            'provider_accepted',
            'going_to_pickup',
            'arrived_pickup',
            'collected',
            'in_transit',
            'arrived_destination',
            'delivered',
            'finished',
            'cancelled',
        ],
        default: 'awaiting_provider',
    },
    statusHistory: [{
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: String, enum: ['user', 'captain', 'system', 'admin'] },
    }],
    photos: {
        pickupUrl: { type: String, default: null },
        deliveryUrl: { type: String, default: null },
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'pix'],
        default: 'cash',
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid'],
        default: 'pending',
    },
    commissionPercent: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    cancelledBy: {
        type: String,
        enum: ['passenger', 'captain', 'system', 'admin'],
    },
    cancellationReason: String,
    cancelledAt: Date,
    passengerReviewSkippedAt: { type: Date, default: null },
    captainReviewSkippedAt: { type: Date, default: null },
}, { timestamps: true });

parcelSchema.index({ status: 1 });
parcelSchema.index({ user: 1 });
parcelSchema.index({ captain: 1 });
parcelSchema.index({ createdAt: -1 });
// SCH-M1 Fase 2: cron de ativação + listagens por janela.
parcelSchema.index({ status: 1, scheduledAt: 1 });
parcelSchema.index({ status: 1, activatedAt: 1 });

parcelSchema.index(
    { captain: 1 },
    {
        name: 'captain_active_parcel_unique',
        unique: true,
        partialFilterExpression: {
            status: {
                $in: [
                    'provider_accepted',
                    'going_to_pickup',
                    'arrived_pickup',
                    'collected',
                    'in_transit',
                    'arrived_destination',
                ],
            },
        },
    }
);

// Um parcel ativo por usuário (inclui awaiting — impede dual-create TOCTOU).
parcelSchema.index(
    { user: 1 },
    {
        name: 'user_active_parcel_unique',
        unique: true,
        partialFilterExpression: {
            status: {
                $in: [
                    'awaiting_provider',
                    'provider_accepted',
                    'going_to_pickup',
                    'arrived_pickup',
                    'collected',
                    'in_transit',
                    'arrived_destination',
                    'delivered',
                ],
            },
        },
    }
);

module.exports = mongoose.model('parcel', parcelSchema);
