const axios = require('axios');
const { withAudit } = require('../audit');
const { upsertAlert, resolveAlert } = require('../alerts');

async function collectFromRenderApi() {
    const apiKey = process.env.RENDER_API_KEY;
    const serviceId = process.env.RENDER_SERVICE_ID;
    if (!apiKey || !serviceId) return null;

    const headers = { Authorization: `Bearer ${apiKey}` };
    const result = await withAudit('render', 'render.service', async () => {
        const { data: service } = await axios.get(
            `https://api.render.com/v1/services/${serviceId}`,
            { headers, timeout: 8000 }
        );
        let deploys = [];
        try {
            const { data } = await axios.get(
                `https://api.render.com/v1/services/${serviceId}/deploys?limit=5`,
                { headers, timeout: 8000 }
            );
            deploys = data || [];
        } catch (_) { /* optional */ }

        return {
            service: service?.service || service,
            deploys: Array.isArray(deploys) ? deploys.map((d) => d.deploy || d) : [],
        };
    }, { retries: 1 });

    if (!result.ok) return { error: result.error?.message };
    return result.data;
}

async function pingOwnHealth() {
    const base = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
    const started = Date.now();
    try {
        const { data, status } = await axios.get(`${base.replace(/\/$/, '')}/api/health`, {
            timeout: 5000,
            validateStatus: () => true,
        });
        return {
            ok: status === 200,
            statusCode: status,
            latencyMs: Date.now() - started,
            data,
        };
    } catch (err) {
        return {
            ok: false,
            statusCode: null,
            latencyMs: Date.now() - started,
            error: err.message,
        };
    }
}

async function collectRender() {
    const mem = process.memoryUsage();
    const local = {
        online: true,
        uptimeSec: Math.round(process.uptime()),
        memory: {
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        },
        nodeVersion: process.version,
        env: process.env.NODE_ENV || 'development',
        version: process.env.APP_VERSION || process.env.RENDER_GIT_COMMIT || 'local',
        lastDeploy: process.env.RENDER_GIT_COMMIT
            ? { commit: process.env.RENDER_GIT_COMMIT.slice(0, 7) }
            : null,
    };

    const ping = await withAudit('render', 'health.ping', () => pingOwnHealth(), { retries: 0 });
    const pingData = ping.ok ? ping.data : { ok: false, error: ping.error?.message };
    const renderApi = await collectFromRenderApi();

    const online = Boolean(pingData?.ok);
    if (!online) {
        await upsertAlert({
            service: 'render',
            code: 'backend_down',
            severity: 'critical',
            title: 'Backend fora do ar',
            message: 'Health check do backend falhou.',
        });
    } else {
        await resolveAlert('render', 'backend_down');
    }

    const svc = renderApi?.service;
    const lastDeploy = renderApi?.deploys?.[0] || null;

    return {
        service: 'render',
        status: online ? 'healthy' : 'critical',
        plan: svc?.serviceDetails?.plan || process.env.RENDER_PLAN || 'Render',
        usagePercent: null,
        source: renderApi?.service ? 'hybrid' : 'internal',
        summary: {
            online,
            uptimeSec: local.uptimeSec,
            latencyMs: pingData?.latencyMs ?? null,
            version: local.version,
        },
        details: {
            local,
            health: pingData,
            render: renderApi?.service
                ? {
                    id: svc.id || svc.service?.id,
                    name: svc.name || svc.service?.name,
                    type: svc.type || svc.service?.type,
                    suspended: svc.suspended || svc.service?.suspended,
                    autoDeploy: svc.autoDeploy || svc.service?.autoDeploy,
                    updatedAt: svc.updatedAt || svc.service?.updatedAt,
                    lastDeploy: lastDeploy
                        ? {
                            id: lastDeploy.id,
                            status: lastDeploy.status,
                            createdAt: lastDeploy.createdAt,
                            finishedAt: lastDeploy.finishedAt,
                            commit: lastDeploy.commit?.id || lastDeploy.commit?.message,
                        }
                        : local.lastDeploy,
                }
                : {
                    configured: Boolean(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID),
                    error: renderApi?.error || null,
                },
            availability30d: null,
            restarts: null,
            note: 'Métricas de CPU do plano Render exigem RENDER_API_KEY + RENDER_SERVICE_ID.',
        },
    };
}

module.exports = { collectRender };
