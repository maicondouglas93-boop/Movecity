const ServiceUsageDaily = require('../../models/serviceUsageDaily.model');

const dayKeyUTC = (date = new Date()) => date.toISOString().slice(0, 10);

/**
 * Incrementa contadores de uso de APIs externas (fire-and-forget seguro).
 * Nunca deve quebrar o fluxo de negócio.
 */
async function trackUsage({
    service,
    sku,
    latencyMs = 0,
    ok = true,
    statusCode = null,
    count = 1,
}) {
    try {
        const dayKey = dayKeyUTC();
        const hour = new Date().getUTCHours();

        let doc = await ServiceUsageDaily.findOne({ service, sku, dayKey });
        if (!doc) {
            doc = new ServiceUsageDaily({
                service,
                sku,
                dayKey,
                hourly: Array(24).fill(0),
            });
        }
        if (!Array.isArray(doc.hourly) || doc.hourly.length !== 24) {
            doc.hourly = Array(24).fill(0);
        }

        doc.requests += count;
        doc.latencySumMs += Number(latencyMs) || 0;
        if (latencyMs != null) doc.latencyCount += 1;
        doc.hourly[hour] = (doc.hourly[hour] || 0) + count;

        if (!ok) {
            doc.errorCount += count;
            if (statusCode === 403) doc.errorsByCode['403'] += count;
            else if (statusCode === 429) doc.errorsByCode['429'] += count;
            else if (statusCode >= 500) doc.errorsByCode['500'] += count;
            else doc.errorsByCode.other += count;
        }

        doc.markModified('hourly');
        doc.markModified('errorsByCode');
        await doc.save();
    } catch (err) {
        // Corrida no upsert: tenta $inc simples
        try {
            const dayKey = dayKeyUTC();
            await ServiceUsageDaily.updateOne(
                { service, sku, dayKey },
                {
                    $inc: {
                        requests: count,
                        errorCount: ok ? 0 : count,
                        latencySumMs: Number(latencyMs) || 0,
                        latencyCount: latencyMs != null ? 1 : 0,
                    },
                    $setOnInsert: { hourly: Array(24).fill(0), errorsByCode: { 403: 0, 429: 0, 500: 0, other: 0 } },
                },
                { upsert: true }
            );
        } catch (err2) {
            console.warn('[usageTracker] falha ao registrar uso:', err2.message);
        }
    }
}

function trackUsageSafe(args) {
    Promise.resolve().then(() => trackUsage(args)).catch(() => {});
}

async function getRangeTotals(service, fromDayKey, toDayKey, sku = null) {
    const match = {
        service,
        dayKey: { $gte: fromDayKey, $lte: toDayKey },
    };
    if (sku) match.sku = sku;

    return ServiceUsageDaily.aggregate([
        { $match: match },
        {
            $group: {
                _id: sku ? null : '$sku',
                requests: { $sum: '$requests' },
                errors: { $sum: '$errorCount' },
                latencySumMs: { $sum: '$latencySumMs' },
                latencyCount: { $sum: '$latencyCount' },
                e403: { $sum: '$errorsByCode.403' },
                e429: { $sum: '$errorsByCode.429' },
                e500: { $sum: '$errorsByCode.500' },
            },
        },
    ]);
}

async function getDailySeries(service, fromDayKey, toDayKey) {
    return ServiceUsageDaily.aggregate([
        {
            $match: {
                service,
                dayKey: { $gte: fromDayKey, $lte: toDayKey },
            },
        },
        {
            $group: {
                _id: '$dayKey',
                requests: { $sum: '$requests' },
                errors: { $sum: '$errorCount' },
            },
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                _id: 0,
                day: '$_id',
                requests: 1,
                errors: 1,
            },
        },
    ]);
}

async function getSkuDaily(service, sku, fromDayKey, toDayKey) {
    return ServiceUsageDaily.find({
        service,
        sku,
        dayKey: { $gte: fromDayKey, $lte: toDayKey },
    })
        .sort({ dayKey: 1 })
        .lean();
}

module.exports = {
    dayKeyUTC,
    trackUsage,
    trackUsageSafe,
    getRangeTotals,
    getDailySeries,
    getSkuDaily,
};
