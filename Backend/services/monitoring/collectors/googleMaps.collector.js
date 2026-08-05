const {
    GOOGLE_MAPS_SKUS,
    maskApiKey,
    pct,
    healthFromPercent,
    shiftDayKey,
    monthBounds,
} = require('../constants');
const { dayKeyUTC, getRangeTotals, getSkuDaily, getDailySeries } = require('../usageTracker');
const { evaluateMapsSkuAlerts } = require('../alerts');

async function collectGoogleMaps() {
    const today = dayKeyUTC();
    const yesterday = shiftDayKey(today, -1);
    const month = monthBounds();
    const historyFrom = shiftDayKey(today, -29);

    const skuKeys = Object.keys(GOOGLE_MAPS_SKUS);
    const skus = [];
    let worstPercent = 0;
    let estimatedMonthCostUsd = 0;
    let estimatedTodayCostUsd = 0;
    let freeCreditSavedUsd = 0;

    for (const sku of skuKeys) {
        const cfg = GOOGLE_MAPS_SKUS[sku];
        const [monthAgg] = await getRangeTotals('google_maps', month.from, month.to, sku);
        const [todayAgg] = await getRangeTotals('google_maps', today, today, sku);
        const [yesterdayAgg] = await getRangeTotals('google_maps', yesterday, yesterday, sku);
        const history = await getSkuDaily('google_maps', sku, historyFrom, today);

        const monthRequests = monthAgg?.requests || 0;
        const todayRequests = todayAgg?.requests || 0;
        const yesterdayRequests = yesterdayAgg?.requests || 0;
        const daysElapsed = Math.max(1, month.dayOfMonth);
        const avgDaily = Math.round((monthRequests / daysElapsed) * 10) / 10;
        const freeLimit = cfg.freeMonthlyRequests;
        const usedPercent = pct(monthRequests, freeLimit) || 0;
        worstPercent = Math.max(worstPercent, usedPercent);

        const monthCostGross = (monthRequests / 1000) * cfg.costPer1000Usd;
        const freeValue = Math.min(monthRequests, freeLimit) / 1000 * cfg.costPer1000Usd;
        const monthCostNet = Math.max(0, monthCostGross - freeValue);
        const todayCost = (todayRequests / 1000) * cfg.costPer1000Usd;

        estimatedMonthCostUsd += monthCostNet;
        estimatedTodayCostUsd += todayCost;
        freeCreditSavedUsd += freeValue;

        const latencyAvg = monthAgg?.latencyCount
            ? Math.round(monthAgg.latencySumMs / monthAgg.latencyCount)
            : null;

        const peakHour = (() => {
            const last = history[history.length - 1];
            if (!last?.hourly) return null;
            let max = -1;
            let idx = null;
            last.hourly.forEach((v, i) => {
                if (v > max) {
                    max = v;
                    idx = i;
                }
            });
            return idx;
        })();

        await evaluateMapsSkuAlerts(sku, cfg.label, usedPercent);

        skus.push({
            sku,
            label: cfg.label,
            requestsToday: todayRequests,
            requestsYesterday: yesterdayRequests,
            requestsMonth: monthRequests,
            avgDaily,
            freeLimit,
            usedOfFree: Math.min(monthRequests, freeLimit),
            remainingFree: Math.max(0, freeLimit - monthRequests),
            usedPercent,
            estimatedMonthCostUsd: Math.round(monthCostNet * 100) / 100,
            estimatedTodayCostUsd: Math.round(todayCost * 100) / 100,
            history30d: history.map((h) => ({
                day: h.dayKey,
                requests: h.requests,
                errors: h.errorCount,
            })),
            peakHourUtc: peakHour,
            apiKeyMasked: maskApiKey(process.env.GOOGLE_MAPS_API),
            status: healthFromPercent(usedPercent, { warn: 50, crit: 90 }),
            latencyAvgMs: latencyAvg,
            errors: monthAgg?.errors || 0,
            errors403: monthAgg?.e403 || 0,
            errors429: monthAgg?.e429 || 0,
            errors500: monthAgg?.e500 || 0,
            configured: Boolean(process.env.GOOGLE_MAPS_API),
        });
    }

    const series = await getDailySeries('google_maps', historyFrom, today);
    const forecastMonth = (() => {
        const daysLeft = Math.max(0, month.daysInMonth - month.dayOfMonth);
        const daily = estimatedMonthCostUsd / Math.max(1, month.dayOfMonth);
        return Math.round((estimatedMonthCostUsd + daily * daysLeft) * 100) / 100;
    })();

    const configured = Boolean(process.env.GOOGLE_MAPS_API);
    const status = !configured
        ? 'unavailable'
        : healthFromPercent(worstPercent, { warn: 50, crit: 90 });

    return {
        service: 'google_maps',
        status,
        plan: configured ? 'Maps Platform (crédito mensal)' : 'Não configurado',
        usagePercent: worstPercent,
        source: 'internal',
        summary: {
            skusConfigured: skus.filter((s) => s.requestsMonth > 0 || s.configured).length,
            worstPercent,
            estimatedMonthCostUsd: Math.round(estimatedMonthCostUsd * 100) / 100,
            estimatedTodayCostUsd: Math.round(estimatedTodayCostUsd * 100) / 100,
            freeCreditSavedUsd: Math.round(freeCreditSavedUsd * 100) / 100,
            forecastMonthCostUsd: forecastMonth,
            apiKeyMasked: maskApiKey(process.env.GOOGLE_MAPS_API),
        },
        details: {
            skus,
            history30d: series,
            note: 'Contadores baseados nas chamadas do backend. Maps JS no cliente não é medido aqui. Limites gratuitos são estimativas configuráveis.',
        },
    };
}

module.exports = { collectGoogleMaps };
