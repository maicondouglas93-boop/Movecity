const mongoose = require('mongoose');
const axios = require('axios');
const { withAudit } = require('../audit');
const { pct, healthFromPercent, MONGODB_ALERT_PCT } = require('../constants');
const { evaluateResourceAlert } = require('../alerts');
const ServiceMonitorSnapshot = require('../../../models/serviceMonitorSnapshot.model');

function atlasDigestAuth(publicKey, privateKey) {
    return {
        username: publicKey,
        password: privateKey,
    };
}

async function collectFromAtlas() {
    const publicKey = process.env.MONGODB_ATLAS_PUBLIC_KEY;
    const privateKey = process.env.MONGODB_ATLAS_PRIVATE_KEY;
    const groupId = process.env.MONGODB_ATLAS_GROUP_ID;
    const clusterName = process.env.MONGODB_ATLAS_CLUSTER_NAME;

    if (!publicKey || !privateKey || !groupId) {
        return null;
    }

    const auth = atlasDigestAuth(publicKey, privateKey);
    const base = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${groupId}`;

    const result = await withAudit('mongodb', 'atlas.cluster', async () => {
        let cluster = null;
        if (clusterName) {
            const { data } = await axios.get(`${base}/clusters/${encodeURIComponent(clusterName)}`, {
                auth,
                timeout: 8000,
            });
            cluster = data;
        } else {
            const { data } = await axios.get(`${base}/clusters`, { auth, timeout: 8000 });
            cluster = data?.results?.[0] || null;
        }

        let measurements = null;
        if (cluster?.name) {
            try {
                const { data } = await axios.get(
                    `${base}/processes`,
                    { auth, timeout: 8000 }
                );
                measurements = { processes: data?.results?.length || 0 };
            } catch (_) {
                /* opcional */
            }
        }

        return { cluster, measurements };
    }, { retries: 1 });

    if (!result.ok) return { error: result.error?.message || 'Atlas API falhou' };
    return result.data;
}

async function collectLocalDbStats() {
    if (mongoose.connection.readyState !== 1) {
        return { connected: false };
    }
    const db = mongoose.connection.db;
    const stats = await db.stats();
    const admin = db.admin();
    let serverStatus = null;
    try {
        serverStatus = await admin.command({ serverStatus: 1 });
    } catch (_) {
        /* Atlas M0 pode restringir serverStatus */
    }

    return {
        connected: true,
        dbName: db.databaseName,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexSize: stats.indexSize,
        collections: stats.collections,
        objects: stats.objects,
        avgObjSize: stats.avgObjSize,
        connections: serverStatus?.connections || null,
        opcounters: serverStatus?.opcounters || null,
        mem: serverStatus?.mem || null,
    };
}

async function collectMongoDB() {
    const local = await withAudit('mongodb', 'db.stats', () => collectLocalDbStats(), { retries: 0 });
    const atlas = await collectFromAtlas();

    const prev = await ServiceMonitorSnapshot.findOne({ service: 'mongodb' }).lean();
    const prevStorage = prev?.details?.local?.storageSize || 0;

    const storageSize = local.ok ? local.data?.storageSize || 0 : 0;
    const dataSize = local.ok ? local.data?.dataSize || 0 : 0;
    // Limite configurável (ex.: M0 = 512MB)
    const storageLimit = Number(process.env.MONGODB_STORAGE_LIMIT_BYTES || 512 * 1024 * 1024);
    const storagePercent = pct(storageSize, storageLimit);

    const connectionsCurrent = local.ok ? local.data?.connections?.current : null;
    const connectionsAvailable = local.ok ? local.data?.connections?.available : null;
    const connectionsLimit = connectionsCurrent != null && connectionsAvailable != null
        ? connectionsCurrent + connectionsAvailable
        : Number(process.env.MONGODB_CONNECTIONS_LIMIT || 500);
    const connectionsPercent = pct(connectionsCurrent, connectionsLimit);

    await evaluateResourceAlert('mongodb', 'storage', storagePercent, 'Armazenamento MongoDB');
    await evaluateResourceAlert('mongodb', 'connections', connectionsPercent, 'Conexões MongoDB');

    const dailyGrowth = storageSize - prevStorage;
    let status = 'unknown';
    if (!local.ok || !local.data?.connected) status = 'critical';
    else status = healthFromPercent(
        Math.max(storagePercent || 0, connectionsPercent || 0),
        { warn: MONGODB_ALERT_PCT, crit: 95 }
    );

    const clusterState = atlas?.cluster?.stateName || (local.ok && local.data?.connected ? 'CONNECTED' : 'UNKNOWN');

    return {
        service: 'mongodb',
        status,
        plan: process.env.MONGODB_ATLAS_TIER || (atlas?.cluster?.providerSettings?.instanceSizeName) || 'Atlas',
        usagePercent: storagePercent,
        source: atlas?.cluster ? 'hybrid' : 'internal',
        summary: {
            storageUsedBytes: storageSize,
            storageLimitBytes: storageLimit,
            storagePercent,
            clusterState,
            dbName: local.ok ? local.data?.dbName : null,
        },
        details: {
            local: local.ok ? local.data : { error: local.error?.message },
            atlas: atlas?.cluster
                ? {
                    name: atlas.cluster.name,
                    stateName: atlas.cluster.stateName,
                    mongoDBVersion: atlas.cluster.mongoDBVersion,
                    paused: atlas.cluster.paused,
                    backupEnabled: atlas.cluster.backupEnabled ?? atlas.cluster.providerBackupEnabled,
                    diskSizeGB: atlas.cluster.diskSizeGB,
                    instanceSize: atlas.cluster.providerSettings?.instanceSizeName,
                }
                : { configured: Boolean(process.env.MONGODB_ATLAS_PUBLIC_KEY), error: atlas?.error || null },
            metrics: {
                storageUsedBytes: storageSize,
                storageFreeBytes: Math.max(0, storageLimit - storageSize),
                dataSizeBytes: dataSize,
                dailyGrowthBytes: dailyGrowth,
                monthlyGrowthBytes: null,
                cpuPercent: null,
                memoryPercent: null,
                connectionsOpen: connectionsCurrent,
                connectionsMax: connectionsLimit,
                connectionsPercent,
                opcounters: local.ok ? local.data?.opcounters : null,
                note: 'CPU/memória de processo exigem Atlas Monitoring API (MONGODB_ATLAS_*).',
            },
        },
    };
}

module.exports = { collectMongoDB };
