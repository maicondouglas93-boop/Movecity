const ServiceMonitorAudit = require('../../models/serviceMonitorAudit.model');

async function recordAudit({
    service,
    operation,
    statusCode = null,
    ok = false,
    latencyMs = null,
    error = null,
    meta = undefined,
}) {
    try {
        await ServiceMonitorAudit.create({
            service,
            operation,
            statusCode,
            ok,
            latencyMs,
            error: error ? String(error).slice(0, 500) : null,
            meta,
        });
    } catch (err) {
        console.warn('[monitorAudit] falha ao gravar:', err.message);
    }
}

/**
 * Executa uma chamada a API externa com retry, medição e auditoria.
 */
async function withAudit(service, operation, fn, { retries = 1, meta } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const started = Date.now();
        try {
            const result = await fn();
            const latencyMs = Date.now() - started;
            await recordAudit({
                service,
                operation,
                statusCode: 200,
                ok: true,
                latencyMs,
                meta: { ...meta, attempt },
            });
            return { ok: true, data: result, latencyMs };
        } catch (err) {
            lastError = err;
            const latencyMs = Date.now() - started;
            const statusCode = err.response?.status || err.statusCode || null;
            await recordAudit({
                service,
                operation,
                statusCode,
                ok: false,
                latencyMs,
                error: err.message,
                meta: { ...meta, attempt },
            });
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
            }
        }
    }
    return { ok: false, error: lastError, latencyMs: null };
}

module.exports = { recordAudit, withAudit };
