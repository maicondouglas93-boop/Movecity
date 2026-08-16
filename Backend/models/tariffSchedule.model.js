const mongoose = require('mongoose');

const tariffScheduleSchema = new mongoose.Schema({
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicleCategory',
        default: null, // null significa tarifa global
        description: "Se for null, o agendamento é para as Tarifas Globais"
    },
    scheduledFor: {
        type: Date,
        required: true,
        description: "Data e hora exatas que a tarifa entrará em vigor"
    },
    changes: {
        type: Object,
        required: true,
        description: "JSON contendo as novas tarifas que serão aplicadas"
    },
    status: {
        type: String,
        enum: ['pending', 'applied', 'failed'],
        default: 'pending'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdminUser',
        description: "Administrador que agendou"
    },
    errorReason: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('tariffSchedule', tariffScheduleSchema);
