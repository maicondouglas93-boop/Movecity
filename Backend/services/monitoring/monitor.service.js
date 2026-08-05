const { getCache, setCache, deleteCache } = require('../../cache/cache');
const ServiceMonitorSnapshot = require('../../models/serviceMonitorSnapshot.model');
const ServiceMonitorAudit = require('../../models/serviceMonitorAudit.model');
const { collectGoogleMaps } = require('./collectors/googleMaps.collector');
const { collectFirebase } = require('./collectors/firebase.collector');
const { collectMongoDB } = require('./collectors/mongo.collector');
const { collectRender } = require('./collectors/render.collector');
const { collectImageKit } = require('./collectors/imagekit.collector');
const { listActiveAlerts, acknowledgeAlert } = require('./alerts');
const { getDailySeries, dayKeyUTC } = require('./usageTracker');
const { shiftDayKey } = require('./constants');

const STATUS_CACHE_TTL = 55; // ~60s
const USAGE_CACHE_TTL = 280; // ~5min
const CACHE_KEY_DASHBOARD = 'monitor:dashboard';
const CACHE_KEY_STATUS = 'monitor:status';

const COLLECTORS = {
    google_maps: collectGoogleMaps,
    firebase: collectFirebase,
    mongodb: collectMongoDB,
    render: collectRender,
    imagekit: collectImageKit,
};

const SERVICE_META = {
    google_maps: { name: 'Google Maps Platform', icon: 'map' },
    firebase: { name: 'Firebase', icon: 'flame' },
    mongodb: { name: 'MongoDB Atlas', icon: 'database' },
    render: { name: 'Backend (Render)', icon: 'server' },
    imagekit: { name: 'ImageKit', icon: 'image' },
};

async function persistSnapshot(payload) {
    const now = new Date();
    const update = {
        status: payload.status,
        plan: payload.plan,
        usagePercent: payload.usagePercent,
        summary: payload.summary,
        details: payload.details,
        source: payload.source,
        syncedAt: now,
    };
    if (payload.status !== 'unavailable' && !payload.summary?.error) {
        update.lastSuccessAt = now;
        update.lastError = null;
    } else if (payload.summary?.error || payload.details?.error) {
        update.lastError = payload.summary?.error || payload.details?.error;
        update.lastErrorAt = now;
    }

    return ServiceMonitorSnapshot.findOneAndUpdate(
        { service: payload.service },
        { $set: update },
        { upsert: true, new: true }
    ).lean();
}

async function collectOne(service, { force = false } = {}) {
    const collector = COLLECTORS[service];
    if (!collector) throw new Error(`Serviço desconhecido: ${service}`);

    try {
        const payload = await collector();
        const saved = await persistSnapshot(payload);
        return saved;
    } catch (err) {
        console.error(`[monitor] falha ao coletar ${service}:`, err.message);
        const prev = await ServiceMonitorSnapshot.findOne({ service }).lean();
        if (prev) {
            await ServiceMonitorSnapshot.updateOne(
                { service },
                {
                    $set: {
                        lastError: err.message,
                        lastErrorAt: new Date(),
                        source: 'cached',
                    },
                }
            );
            return {
                ...prev,
                source: 'cached',
                lastError: err.message,
                stale: true,
            };
        }
        return {
            service,
            status: 'unavailable',
            plan: '—',
            usagePercent: null,
            summary: { error: err.message },
            details: {},
            source: 'internal',
            syncedAt: new Date(),
            lastError: err.message,
        };
    }
}

async function refreshAll({ force = false } = {}) {
    const services = Object.keys(COLLECTORS);
    const results = [];
    for (const service of services) {
        // Sequencial para não estourar rate limits
        results.push(await collectOne(service, { force }));
    }
    return results;
}

function overallHealth(snapshots, alerts) {
    if (alerts.some((a) => a.severity === 'critical' && !a.acknowledged)) return 'critical';
    if (snapshots.some((s) => s.status === 'critical')) return 'critical';
    if (alerts.some((a) => a.severity === 'warning') || snapshots.some((s) => s.status === 'attention')) {
        return 'attention';
    }
    if (snapshots.every((s) => s.status === 'unavailable')) return 'unknown';
    return 'healthy';
}

function buildCards(snapshots) {
    return snapshots.map((s) => ({
        service: s.service,
        name: SERVICE_META[s.service]?.name || s.service,
        icon: SERVICE_META[s.service]?.icon || 'activity',
        status: s.status,
        plan: s.plan,
        usage: s.summary,
        usagePercent: s.usagePercent,
        limitHint: s.summary?.storageLimitBytes
            || s.summary?.worstPercent != null
            || s.details?.metrics?.storageLimitBytes
            || null,
        lastUpdated: s.syncedAt || s.updatedAt,
        lastSuccessAt: s.lastSuccessAt,
        source: s.source,
        stale: s.source === 'cached' || Boolean(s.stale),
    }));
}

function buildCosts(snapshots) {
    const maps = snapshots.find((s) => s.service === 'google_maps');
    const month = maps?.summary?.estimatedMonthCostUsd || 0;
    const today = maps?.summary?.estimatedTodayCostUsd || 0;
    const saved = maps?.summary?.freeCreditSavedUsd || 0;
    const forecast = maps?.summary?.forecastMonthCostUsd || month;
    return {
        estimatedMonthUsd: month,
        estimatedTodayUsd: today,
        freePlanSavingsUsd: saved,
        forecastMonthEndUsd: forecast,
        currency: 'USD',
        note: 'Estimativa baseada no uso instrumentado do backend (Google Maps). Outros serviços entram quando APIs oficiais retornam custo.',
    };
}

async function getDashboard({ force = false } = {}) {
    if (!force) {
        const cached = getCache(CACHE_KEY_DASHBOARD);
        if (cached) return { ...cached, cached: true };
    }

    const snapshots = await refreshAll({ force });
    const alerts = await listActiveAlerts(40);
    const cards = buildCards(snapshots);
    const health = overallHealth(snapshots, alerts);
    const costs = buildCosts(snapshots);

    const today = dayKeyUTC();
    const history7 = await getDailySeries('google_maps', shiftDayKey(today, -6), today);
    const history30 = await getDailySeries('google_maps', shiftDayKey(today, -29), today);

    const payload = {
        health,
        healthLabel: health === 'healthy' ? 'Saudável' : health === 'attention' ? 'Atenção' : health === 'critical' ? 'Crítico' : 'Desconhecido',
        cards,
        costs,
        alerts,
        history: {
            last7Days: history7,
            last30Days: history30,
            last12Months: [], // preenchido sob demanda / agregação mensal futura
        },
        services: snapshots,
        refreshedAt: new Date().toISOString(),
        intervals: {
            statusSeconds: 60,
            usageSeconds: 300,
        },
        cached: false,
    };

    setCache(CACHE_KEY_DASHBOARD, payload, USAGE_CACHE_TTL);
    setCache(CACHE_KEY_STATUS, { health, cards, refreshedAt: payload.refreshedAt }, STATUS_CACHE_TTL);
    return payload;
}

async function getStatusFast() {
    const cached = getCache(CACHE_KEY_STATUS);
    if (cached) return { ...cached, cached: true };

    const snapshots = await ServiceMonitorSnapshot.find({}).lean();
    if (!snapshots.length) {
        return getDashboard({ force: true }).then((d) => ({
            health: d.health,
            cards: d.cards,
            refreshedAt: d.refreshedAt,
            cached: false,
        }));
    }
    const alerts = await listActiveAlerts(20);
    const cards = buildCards(snapshots);
    const health = overallHealth(snapshots, alerts);
    const payload = { health, cards, refreshedAt: new Date().toISOString(), cached: false };
    setCache(CACHE_KEY_STATUS, payload, STATUS_CACHE_TTL);
    return payload;
}

async function getServiceDetail(service) {
    if (!COLLECTORS[service]) {
        const err = new Error('Serviço não encontrado');
        err.statusCode = 404;
        throw err;
    }
    // Atualiza este serviço e devolve snapshot
    const snap = await collectOne(service, { force: true });
    deleteCache(CACHE_KEY_DASHBOARD);
    deleteCache(CACHE_KEY_STATUS);
    return snap;
}

async function getAuditLogs({ service, limit = 50, skip = 0 } = {}) {
    const filter = {};
    if (service) filter.service = service;
    const [items, total] = await Promise.all([
        ServiceMonitorAudit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Math.min(limit, 200)).lean(),
        ServiceMonitorAudit.countDocuments(filter),
    ]);
    return { items, total };
}

module.exports = {
    getDashboard,
    getStatusFast,
    getServiceDetail,
    refreshAll,
    getAuditLogs,
    listActiveAlerts,
    acknowledgeAlert,
    SERVICE_META,
};
