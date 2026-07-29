const mongoose = require('mongoose');

const pricingRuleSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        description: "Nome da regra (ex: Rain Rules, Night Rules, Rural Zone)"
    },
    type: {
        type: String,
        enum: ['weather', 'time_based', 'date_based', 'location_based', 'custom'],
        required: true,
        description: "Categoria da Regra"
    },
    modificationType: {
        type: String,
        enum: ['fixed', 'percentage'],
        required: true,
        description: "Adiciona um valor fixo ou multiplica (percentual)"
    },
    value: {
        type: Number,
        required: true,
        description: "Valor fixo ou percentual (ex: 15 para +15%)"
    },
    conditions: {
        type: mongoose.Schema.Types.Mixed,
        description: "Objeto de condições (horário inicial/final, dias, polígonos)"
    },
    priority: {
        type: Number,
        default: 0,
        description: "Prioridade de aplicação no cálculo"
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('pricingRule', pricingRuleSchema);
