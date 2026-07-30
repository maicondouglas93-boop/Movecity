const Ride = require('../models/ride.model');
const User = require('../models/user.model');
const Captain = require('../models/captain.model');

/**
 * Funções de Agregação e Relatórios (Business Intelligence)
 */

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
    const [currentStats, prevStats, currentCancellations, prevCancellations] = await Promise.all([
        Ride.aggregate([
            { $match: matchCurrent },
            { $group: { _id: null, totalRevenue: { $sum: '$fare' }, totalRides: { $sum: 1 }, totalCommission: { $sum: { $ifNull: ['$commissionAmount', { $multiply: ['$fare', 0.15] }] } } } }
        ]),
        Ride.aggregate([
            { $match: matchPrev },
            { $group: { _id: null, totalRevenue: { $sum: '$fare' }, totalRides: { $sum: 1 } } }
        ]),
        Ride.countDocuments({ createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }, status: 'cancelled' }),
        Ride.countDocuments({ createdAt: { $gte: prevStartDate, $lte: prevEndDate }, status: 'cancelled' })
    ]);

    const curr = currentStats[0] || { totalRevenue: 0, totalRides: 0, totalCommission: 0 };
    const prev = prevStats[0] || { totalRevenue: 0, totalRides: 0 };

    const getGrowth = (c, p) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);

    // SLAs simulados para demonstração da V1 (Pois o Ride schema não guarda os timestamps finos ainda)
    const sla = {
        avgWaitToAccept: 135, // 2m 15s
        avgWaitToArrive: 240, // 4m
        avgRideTime: 780,     // 13m
    };

    return {
        revenue: {
            current: curr.totalRevenue,
            growth: getGrowth(curr.totalRevenue, prev.totalRevenue)
        },
        profit: {
            current: curr.totalCommission,
            growth: getGrowth(curr.totalCommission, prev.totalRevenue * 0.15)
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
            growth: getGrowth(currentCancellations, prevCancellations)
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
                revenue: { $sum: '$fare' }, 
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
            { $group: { _id: "$vehicleType", count: { $sum: 1 }, revenue: { $sum: '$fare' } } }
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
            { $group: { _id: "$user", rides: { $sum: 1 }, spent: { $sum: '$fare' } } },
            { $sort: { spent: -1 } },
            { $limit: Number(limit) },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: "$user" }
        ]),
        Ride.aggregate([
            { $match: matchDate },
            { $group: { _id: "$captain", rides: { $sum: 1 }, earnings: { $sum: { $subtract: ['$fare', { $ifNull: ['$commissionAmount', { $multiply: ['$fare', 0.15] }] }] } } } },
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
