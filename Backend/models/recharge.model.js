const mongoose = require('mongoose');

const rechargeSchema = new mongoose.Schema({
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    method: {
        type: String,
        enum: ['asaas_pix', 'asaas_boleto', 'asaas_card', 'manual'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending'
    },
    asaasInvoiceId: {
        type: String // Guardar ID da cobrança do Asaas
    },
    qrCode: {
        type: String
    },
    pixCopyPaste: {
        type: String
    },
    adminId: {
        type: String // Se manual, registra o Admin
    }
}, { timestamps: true });

module.exports = mongoose.model('recharge', rechargeSchema);
