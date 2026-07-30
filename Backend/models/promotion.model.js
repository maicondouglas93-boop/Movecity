const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
    // Identificação Básica
    type: { type: String, enum: ['coupon', 'campaign', 'referral', 'auto_apply'], default: 'coupon' },
    code: { type: String, uppercase: true, trim: true, index: true }, // ex: MOVE20, opcional se for campanha sem código
    title: { type: String, required: true },
    description: { type: String },
    
    // Benefício
    discountType: { type: String, enum: ['percentage', 'fixed', 'cashback', 'free_ride'], default: 'percentage' },
    value: { type: Number, required: true, min: 0 },
    maxDiscountLimit: { type: Number }, // Teto do desconto em Reais (ex: max R$ 20 de desconto num cupom de 50%)

    // Segmentação (Regras Complexas)
    rules: {
        cities: [{ type: String }],
        states: [{ type: String }],
        vehicleCategories: [{ type: String }], // 'Moto', 'Carro'
        paymentMethods: [{ type: String }], // 'pix', 'cash', 'card'
        userTags: [{ type: String }], // 'new', 'vip', 'inactive'
        
        // Janela de Tempo
        timeWindow: {
            startTime: { type: String }, // ex: "18:00"
            endTime: { type: String },   // ex: "23:59"
            allowedDays: [{ type: Number }] // 0=Domingo, 1=Segunda, etc.
        },
        
        // Corridas do usuário
        minUserRides: { type: Number },
        maxUserRides: { type: Number },
        inactiveDays: { type: Number },
        firstRideOnly: { type: Boolean, default: false }
    },

    // Validade e Agendamento
    startDate: { type: Date, required: true },
    endDate: { type: Date },

    // Orçamento e Limites
    budgetLimit: { type: Number }, // Orçamento máximo da campanha (ex R$ 5000)
    currentBudgetUsed: { type: Number, default: 0 },
    
    globalUsageLimit: { type: Number }, // Quantas vezes no total o cupom pode ser usado
    usagePerUserLimit: { type: Number, default: 1 },
    usagePerDayLimit: { type: Number },
    
    // Compatibilidade
    combinable: { type: Boolean, default: false },

    // Mídia (App Frontend)
    bannerImage: { type: String },
    actionLink: { type: String },

    // Status
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'paused', 'finished', 'cancelled'], default: 'draft' },

    // Métricas (Dashboard)
    metrics: {
        views: { type: Number, default: 0 },
        activations: { type: Number, default: 0 },
        uses: { type: Number, default: 0 },
        revenueGenerated: { type: Number, default: 0 },
        totalDiscountGiven: { type: Number, default: 0 },
        newClientsAcquired: { type: Number, default: 0 }
    },

    // Auditoria
    auditLogs: [{
        adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
        adminName: { type: String },
        action: { type: String }, // 'created', 'updated', 'paused', 'finished'
        date: { type: Date, default: Date.now },
        details: { type: String }
    }]

}, { timestamps: true });

module.exports = mongoose.model('Promotion', promotionSchema);
