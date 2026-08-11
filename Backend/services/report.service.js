const Ride = require('../models/ride.model');
const User = require('../models/user.model');
const Captain = require('../models/captain.model');

/**
 * Funções de Agregação e Relatórios (Business Intelligence)
 */

// Auditoria "histórico mostra estimativa" (2026-08-10): estes relatórios já filtram
// status:'finished' — ou seja, toda corrida aqui já foi concluída e tem um valor FINAL
// recalculado (finalPrice), que pode ser diferente do fare congelado na criação
// (estimativa). Somar `$fare` direto inflava/deflava receita, ticket médio, comissão e
// ranking de motoristas/passageiros sempre que o valor real divergia da estimativa.
// Mesma regra do histórico do passageiro: valor final > estimativa para corrida
// concluída, com fallback só para corridas antigas sem finalPrice persistido.
const CHARGED_FARE_EXPR = { $ifNull: [ '$finalPrice', '$fare' ] };

module.exports.getExecutiveDashboard = async (startDate, endDate) => {
    const matchCurrent = {
        createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
        status: 'finished'
    };

    // Calcular período anterior para comparativo
    const duration = new Date(endDate) - new Date(startDate);
    const prevStartDate = new Date(new Date(startDate).getTime() - duration);
    const prevEndDate = new Date(new Date(endDate).getTime() - duration);

    const matchPrev = {
        createdAt: { $gte: prevStartDate, $lte: prevEndDate },
        status: 'finished'
    };

    // Agregações principais
    const [currentStats, prevStats, currentCancellations, prevCancellations, currentRequested, prevRequested, slaStats] = await Promise.all([
        Ride.aggregate([
            { $match: matchCurrent },
            { $group: { _id: null, totalRevenue: { $sum: CHARGED_FARE_EXPR }, totalRides: { $sum: 1 }, totalCommission: { $sum: { $ifNull: ['$commissionAmount', { $multiply: [ CHARGED_FARE_EXPR, 0.15 ] }] } }, totalDiscount: { $sum: { $ifNull: ['$discountAmount', 0] } } } }
        ]),
        Ride.aggregate([
            { $match: matchPrev },
            { $group: { _id: null, totalRevenue: { $sum: CHARGED_FARE_EXPR }, totalRides: { $sum: 1 }, totalCommission: { $sum: { $ifNull: ['$commissionAmount', { $multiply: [ CHARGED_FARE_EXPR, 0.15 ] }] } } } }
        ]),
        Ride.countDocuments({ createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }, status: 'cancelled' }),
        Ride.countDocuments({ createdAt: { $gte: prevStartDate, $lte: prevEndDate }, status: 'cancelled' }),
        // Total solicitado no período (todo status, não só finalizadas) — denominador
        // correto da taxa de cancelamento. Antes dividia canceladas por finalizadas,
        // o que não representa "% do que foi pedido que foi cancelado".
        Ride.countDocuments({ createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } }),
        Ride.countDocuments({ createdAt: { $gte: prevStartDate, $lte: prevEndDate } }),
        // SLA real (2026-08-10) — acceptedAt/arrivedAt/startedAt/finishedAt só existem em
        // corridas transitadas após essa mudança; corridas antigas ficam de fora do
        // $match e não distorcem a média com null/undefined.
        Ride.aggregate([
            { $match: { ...matchCurrent, acceptedAt: { $ne: null }, arrivedAt: { $ne: null }, startedAt: { $ne: null }, finishedAt: { $ne: null } } },
            { $group: {
                _id: null,
                avgWaitToAccept: { $avg: { $divide: [{ $subtract: ['$acceptedAt', '$createdAt'] }, 1000] } },
                avgWaitToArrive: { $avg: { $divide: [{ $subtract: ['$arrivedAt', '$acceptedAt'] }, 1000] } },
                avgRideTime: { $avg: { $divide: [{ $subtract: ['$finishedAt', '$startedAt'] }, 1000] } },
                sampleSize: { $sum: 1 },
            } }
        ]),
    ]);

    const curr = currentStats[0] || { totalRevenue: 0, totalRides: 0, totalCommission: 0, totalDiscount: 0 };
    const prev = prevStats[0] || { totalRevenue: 0, totalRides: 0, totalCommission: 0 };
    const slaRaw = slaStats[0];

    const getGrowth = (c, p) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);

    // sampleSize baixo (ride novo pra esse jeito de calcular) é sinalizado pro
    // frontend não exibir uma média pouco confiável como se fosse definitiva.
    const sla = {
        hasData: !!slaRaw && slaRaw.sampleSize > 0,
        sampleSize: slaRaw?.sampleSize || 0,
        avgWaitToAccept: slaRaw ? Math.round(slaRaw.avgWaitToAccept) : null,
        avgWaitToArrive: slaRaw ? Math.round(slaRaw.avgWaitToArrive) : null,
        avgRideTime: slaRaw ? Math.round(slaRaw.avgRideTime) : null,
    };

    return {
        revenue: {
            current: curr.totalRevenue,
            growth: getGrowth(curr.totalRevenue, prev.totalRevenue)
        },
        profit: {
            current: curr.totalCommission,
            growth: getGrowth(curr.totalCommission, prev.totalCommission)
        },
        discount: {
            current: curr.totalDiscount,
        },
        rides: {
            current: curr.totalRides,
            growth: getGrowth(curr.totalRides, prev.totalRides)
        },
        avgTicket: {
            current: curr.totalRides ? curr.totalRevenue / curr.totalRides : 0,
            growth: getGrowth(curr.totalRides ? curr.totalRevenue / curr.totalRides : 0, prev.totalRides ? prev.totalRevenue / prev.totalRides : 0)
        },
        cancellations: {
            current: currentCancellations,
            growth: getGrowth(currentCancellations, prevCancellations),
            rate: currentRequested ? (currentCancellations / currentRequested) * 100 : 0,
            ratePrev: prevRequested ? (prevCancellations / prevRequested) * 100 : 0,
        },
        sla
    };
};

module.exports.getChartsData = async (startDate, endDate) => {
    const matchDate = { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }, status: 'finished' };

    const [dailyRevenue, paymentMethods, categories, heatmap] = await Promise.all([
        Ride.aggregate([
            { $match: matchDate },
            { $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                revenue: { $sum: CHARGED_FARE_EXPR },
                rides: { $sum: 1 }
            }},
            { $sort: { _id: 1 } }
        ]),
        Ride.aggregate([
            { $match: matchDate },
            { $group: { _id: "$paymentMethod", count: { $sum: 1 } } }
        ]),
        Ride.aggregate([
            { $match: matchDate },
            { $group: { _id: "$vehicleType", count: { $sum: 1 }, revenue: { $sum: CHARGED_FARE_EXPR } } }
        ]),
        Ride.aggregate([
            { $match: matchDate },
            { $group: { 
                _id: { 
                    day: { $dayOfWeek: "$createdAt" }, 
                    hour: { $hour: "$createdAt" } 
                }, 
                count: { $sum: 1 } 
            }}
        ])
    ]);

    return {
        revenueChart: dailyRevenue,
        piePayments: paymentMethods,
        pieCategories: categories,
        heatmap
    };
};

module.exports.getRankings = async (startDate, endDate, limit = 10) => {
    const matchDate = { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }, status: 'finished' };

    const [topPassengers, topCaptains] = await Promise.all([
        Ride.aggregate([
            { $match: matchDate },
            { $group: { _id: "$user", rides: { $sum: 1 }, spent: { $sum: CHARGED_FARE_EXPR } } },
            { $sort: { spent: -1 } },
            { $limit: Number(limit) },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: "$user" }
        ]),
        Ride.aggregate([
            { $match: matchDate },
            { $group: { _id: "$captain", rides: { $sum: 1 }, earnings: { $sum: { $subtract: [ CHARGED_FARE_EXPR, { $ifNull: ['$commissionAmount', { $multiply: [ CHARGED_FARE_EXPR, 0.15 ] }] } ] } } } },
            { $sort: { earnings: -1 } },
            { $limit: Number(limit) },
            { $lookup: { from: 'captains', localField: '_id', foreignField: '_id', as: 'captain' } },
            { $unwind: { path: "$captain", preserveNullAndEmptyArrays: true } }
        ])
    ]);

    return {
        topPassengers: topPassengers.map(p => ({
            name: `${p.user.fullname?.firstname} ${p.user.fullname?.lastname}`,
            rides: p.rides,
            amount: p.spent
        })),
        topCaptains: topCaptains.filter(c => c.captain).map(c => ({
            name: `${c.captain.fullname?.firstname} ${c.captain.fullname?.lastname}`,
            rides: c.rides,
            amount: c.earnings
        }))
    };
};
