const promotionModel = require('../models/promotion.model');
const promotionUsageModel = require('../models/promotionUsage.model');
const userModel = require('../models/user.model');

// A mesma matemática é usada pelo simulador do painel e pela criação da corrida.
// O módulo aceita somente cupons de porcentagem ou valor fixo.
module.exports.evaluateDiscount = (promotion, rideValue) => {
    let discount = 0;

    if (promotion.discountType === 'percentage') {
        discount = rideValue * (promotion.value / 100);
        if (promotion.maxDiscountLimit && discount > promotion.maxDiscountLimit) {
            discount = promotion.maxDiscountLimit;
        }
    } else if (promotion.discountType === 'fixed') {
        discount = promotion.value;
        if (promotion.maxDiscountLimit && discount > promotion.maxDiscountLimit) {
            discount = promotion.maxDiscountLimit;
        }
    }

    // Nunca descontar mais do que a própria corrida vale.
    discount = Math.min(discount, rideValue);
    const clientPays = Math.max(0, rideValue - discount);

    return { discount, clientPays, subsidy: rideValue - clientPays };
};

// Retorna { promotion, discountAmount } se o código for válido e aplicável agora, ou
// { error } com um motivo legível se não for — nunca lança exceção, porque um cupom
// inválido não deve derrubar a criação da corrida (o passageiro só não recebe desconto).
module.exports.findApplicablePromotion = async ({ code, userId, vehicleType, paymentMethod, rideValue }) => {
    if (!code) return null;

    const promotion = await promotionModel.findOne({ type: 'coupon', code: code.toUpperCase().trim() });
    if (!promotion) return { error: 'Cupom não encontrado' };

    if (promotion.status !== 'active') return { error: 'Este cupom não está ativo' };

    const now = new Date();
    if (promotion.startDate && promotion.startDate > now) return { error: 'Este cupom ainda não começou a valer' };
    if (promotion.endDate && promotion.endDate < now) return { error: 'Este cupom expirou' };

    if (promotion.budgetLimit && promotion.currentBudgetUsed >= promotion.budgetLimit) {
        return { error: 'Este cupom atingiu o orçamento máximo' };
    }

    const user = await userModel.findById(userId);
    if (!user) return { error: 'Usuário não encontrado' };

    const rules = promotion.rules || {};

    if (rules.cities?.length > 0 && !rules.cities.includes(user.city)) {
        return { error: 'Este cupom não é válido para a sua cidade' };
    }
    if (rules.vehicleCategories?.length > 0 && !rules.vehicleCategories.includes(vehicleType)) {
        return { error: 'Este cupom não é válido para esta categoria de veículo' };
    }
    if (rules.paymentMethods?.length > 0 && !rules.paymentMethods.includes(paymentMethod)) {
        return { error: 'Este cupom não é válido para este método de pagamento' };
    }
    if (rules.userTags?.length > 0 && !(user.tags || []).some(tag => rules.userTags.includes(tag))) {
        return { error: 'Este cupom não é válido para o seu perfil' };
    }
    if (rules.firstRideOnly && (user.totalRides || 0) > 0) {
        return { error: 'Este cupom é válido apenas para a primeira corrida' };
    }
    if (rules.minUserRides !== undefined && (user.totalRides || 0) < rules.minUserRides) {
        return { error: 'Este cupom exige um histórico maior de corridas' };
    }
    if (rules.maxUserRides !== undefined && (user.totalRides || 0) > rules.maxUserRides) {
        return { error: 'Este cupom não é mais válido para o seu perfil' };
    }
    if (rules.inactiveDays !== undefined && user.lastRideAt) {
        const daysSinceLastRide = (now - new Date(user.lastRideAt)) / (1000 * 60 * 60 * 24);
        if (daysSinceLastRide < rules.inactiveDays) {
            return { error: 'Este cupom é válido apenas para usuários inativos' };
        }
    }
    if (rules.timeWindow?.allowedDays?.length > 0 && !rules.timeWindow.allowedDays.includes(now.getDay())) {
        return { error: 'Este cupom não é válido hoje' };
    }
    if (rules.timeWindow?.startTime && rules.timeWindow?.endTime) {
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (currentTime < rules.timeWindow.startTime || currentTime > rules.timeWindow.endTime) {
            return { error: 'Este cupom só é válido em um horário específico' };
        }
    }

    if (promotion.globalUsageLimit !== undefined) {
        const totalUses = await promotionUsageModel.countDocuments({
            promotionId: promotion._id,
            reversedAt: null,
        });
        if (totalUses >= promotion.globalUsageLimit) return { error: 'Este cupom atingiu o limite total de usos' };
    }
    if (promotion.usagePerUserLimit !== undefined) {
        const userUses = await promotionUsageModel.countDocuments({
            promotionId: promotion._id,
            userId,
            reversedAt: null,
        });
        if (userUses >= promotion.usagePerUserLimit) return { error: 'Você já utilizou este cupom o número máximo de vezes' };
    }
    if (promotion.usagePerDayLimit !== undefined) {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const usesToday = await promotionUsageModel.countDocuments({
            promotionId: promotion._id,
            createdAt: { $gte: startOfDay },
            reversedAt: null,
        });
        if (usesToday >= promotion.usagePerDayLimit) return { error: 'Este cupom atingiu o limite de usos de hoje' };
    }

    const { discount } = module.exports.evaluateDiscount(promotion, rideValue);
    if (discount <= 0) return { error: 'Este cupom não gera desconto para esta corrida' };
    if (promotion.budgetLimit && ((promotion.currentBudgetUsed || 0) + discount) > promotion.budgetLimit) {
        return { error: 'Este cupom não possui orçamento suficiente para este desconto' };
    }

    return { promotion, discountAmount: discount };
};

// Registra o uso e credita o gasto de orçamento/métricas da promoção. Chamado na
// criação da corrida (não na finalização) — ver decisão de escopo no plano do Bloco H.
module.exports.recordPromotionUsage = async ({ promotionId, userId, rideId, discountAmount, session }) => {
    if (session) {
        await promotionUsageModel.create(
            [{ promotionId, userId, rideId, discountAmount }],
            { session }
        );
    } else {
        await promotionUsageModel.create({ promotionId, userId, rideId, discountAmount });
    }
    await promotionModel.findByIdAndUpdate(promotionId, {
        $inc: {
            currentBudgetUsed: discountAmount,
            'metrics.uses': 1,
            'metrics.totalDiscountGiven': discountAmount
        }
    }, session ? { session } : undefined);
};
