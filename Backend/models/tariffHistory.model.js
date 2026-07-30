const mongoose = require('mongoose');

const tariffHistorySchema = new mongoose.Schema({
    admin: {
        type: String,
        required: true,
        description: "Nome ou ID do administrador responsável pela alteração"
    },
    ip: {
        type: String,
        description: "Endereço IP da alteração"
    },
    browser: {
        type: String,
        description: "User agent do navegador"
    },
    action: {
        type: String,
        enum: ['create', 'update', 'delete'],
        required: true
    },
    entity: {
        type: String,
        required: true,
        description: "Model afetado (ex: VehicleCategory, TariffSetting)"
    },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicleCategory',
        description: "ID da categoria, caso aplicável"
    },
    oldValue: {
        type: mongoose.Schema.Types.Mixed
    },
    newValue: {
        type: mongoose.Schema.Types.Mixed
    },
    reason: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('tariffHistory', tariffHistorySchema);
