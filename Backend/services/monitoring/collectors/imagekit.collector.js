const axios = require('axios');
const imagekitConfig = require('../../../config/imagekit');
const { withAudit } = require('../audit');
const { IMAGEKIT_FREE, pct, healthFromPercent, monthBounds } = require('../constants');
const { dayKeyUTC } = require('../usageTracker');

function formatDate(d) {
    return d.toISOString().slice(0, 10);
}

async function collectImageKit() {
    const configured = imagekitConfig.isConfigured();
    if (!configured) {
        return {
            service: 'imagekit',
            status: 'unavailable',
            plan: 'Não configurado',
            usagePercent: null,
            source: 'internal',
            summary: { configured: false },
            details: { note: 'Defina IMAGEKIT_URL_ENDPOINT, PUBLIC_KEY e PRIVATE_KEY.' },
        };
    }

    const month = monthBounds();
    const today = dayKeyUTC();
    const endExclusive = formatDate(new Date(Date.now() + 86400000));

    const usage = await withAudit('imagekit', 'accounts.usage', async () => {
        // API oficial: GET /v1/accounts/usage
        const { data } = await axios.get('https://api.imagekit.io/v1/accounts/usage', {
            auth: { username: process.env.IMAGEKIT_PRIVATE_KEY, password: '' },
            params: {
                startDate: month.from,
                endDate: endExclusive,
            },
            timeout: 10000,
        });
        return data;
    }, { retries: 1 });

    let filesCount = null;
    const filesProbe = await withAudit('imagekit', 'files.list', async () => {
        if (imagekitConfig.client?.files?.list) {
            const res = await imagekitConfig.client.files.list({ limit: 1 });
            return res;
        }
        const { data } = await axios.get('https://api.imagekit.io/v1/files', {
            auth: { username: process.env.IMAGEKIT_PRIVATE_KEY, password: '' },
            params: { limit: 1 },
            timeout: 8000,
        });
        return data;
    }, { retries: 0 });

    if (filesProbe.ok) {
        // total pode vir em header ou não — SDK varia
        filesCount = Array.isArray(filesProbe.data) ? filesProbe.data.length : null;
    }

    if (!usage.ok) {
        return {
            service: 'imagekit',
            status: 'attention',
            plan: 'ImageKit',
            usagePercent: null,
            source: 'cached_or_unavailable',
            summary: { configured: true, error: usage.error?.message },
            details: {
                error: usage.error?.message,
                publicKeyMasked: process.env.IMAGEKIT_PUBLIC_KEY
                    ? `${process.env.IMAGEKIT_PUBLIC_KEY.slice(0, 6)}…`
                    : null,
            },
        };
    }

    const data = usage.data || {};
    const storageUsed = data.mediaLibraryStorageBytes || data.storageBytes || 0;
    const bandwidthUsed = data.bandwidthBytes || 0;
    const storageLimit = IMAGEKIT_FREE.storageBytes;
    const bandwidthLimit = IMAGEKIT_FREE.bandwidthBytes;
    const storagePercent = pct(storageUsed, storageLimit);
    const bandwidthPercent = pct(bandwidthUsed, bandwidthLimit);
    const worst = Math.max(storagePercent || 0, bandwidthPercent || 0);

    return {
        service: 'imagekit',
        status: healthFromPercent(worst, { warn: 70, crit: 90 }),
        plan: process.env.IMAGEKIT_PLAN || 'Free/Paid',
        usagePercent: worst,
        source: 'official',
        summary: {
            storageUsedBytes: storageUsed,
            storageLimitBytes: storageLimit,
            storagePercent,
            bandwidthUsedBytes: bandwidthUsed,
            bandwidthLimitBytes: bandwidthLimit,
            bandwidthPercent,
            remainingStorageBytes: Math.max(0, storageLimit - storageUsed),
            remainingBandwidthBytes: Math.max(0, bandwidthLimit - bandwidthUsed),
        },
        details: {
            storageUsedBytes: storageUsed,
            storageRemainingBytes: Math.max(0, storageLimit - storageUsed),
            bandwidthUsedBytes: bandwidthUsed,
            bandwidthRemainingBytes: Math.max(0, bandwidthLimit - bandwidthUsed),
            imagesCount: filesCount,
            uploadsToday: null,
            uploadsMonth: null,
            downloads: null,
            transformations: data.extensionUnitsCount ?? null,
            videoProcessingUnits: data.videoProcessingUnitsCount ?? null,
            estimatedCostUsd: null,
            freeLimitRemaining: {
                storageBytes: Math.max(0, storageLimit - storageUsed),
                bandwidthBytes: Math.max(0, bandwidthLimit - bandwidthUsed),
            },
            period: { from: month.from, to: today },
            raw: {
                originalCacheStorageBytes: data.originalCacheStorageBytes,
            },
        },
    };
}

module.exports = { collectImageKit };
