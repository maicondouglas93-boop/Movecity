const Notification = require('../models/notification.model');

/**
 * Métricas agregadas das notificações in-app enviadas pelo admin/campanhas.
 */
async function inboxStats({ limit = 50 } = {}) {
    const recent = await Notification.aggregate([
        { $match: { origin: { $in: ['admin', 'campaign'] }, userId: { $ne: null } } },
        {
            $group: {
                _id: { title: '$title', message: '$message', createdDay: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
                delivered: { $sum: 1 },
                read: { $sum: { $cond: ['$read', 1, 0] } },
                lastAt: { $max: '$createdAt' },
                category: { $first: '$category' },
                priority: { $first: '$priority' },
            },
        },
        { $sort: { lastAt: -1 } },
        { $limit: Math.min(Number(limit) || 50, 100) },
    ]);

    // Inclui também as de motoristas (captainId)
    const recentDrivers = await Notification.aggregate([
        { $match: { origin: { $in: ['admin', 'campaign'] }, captainId: { $ne: null } } },
        {
            $group: {
                _id: { title: '$title', message: '$message', createdDay: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
                delivered: { $sum: 1 },
                read: { $sum: { $cond: ['$read', 1, 0] } },
                lastAt: { $max: '$createdAt' },
                category: { $first: '$category' },
                priority: { $first: '$priority' },
            },
        },
        { $sort: { lastAt: -1 } },
        { $limit: Math.min(Number(limit) || 50, 100) },
    ]);

    const map = new Map();
    for (const row of [...recent, ...recentDrivers]) {
        const key = `${row._id.title}|${row._id.message}|${row._id.createdDay}`;
        const prev = map.get(key);
        if (prev) {
            prev.delivered += row.delivered;
            prev.read += row.read;
            if (row.lastAt > prev.lastAt) prev.lastAt = row.lastAt;
        } else {
            map.set(key, {
                title: row._id.title,
                message: row._id.message,
                day: row._id.createdDay,
                delivered: row.delivered,
                read: row.read,
                lastAt: row.lastAt,
                category: row.category,
                priority: row.priority,
            });
        }
    }

    return {
        items: [...map.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)).slice(0, limit),
    };
}

module.exports = { inboxStats };
