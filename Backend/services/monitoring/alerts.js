const ServiceMonitorAlert = require('../../models/serviceMonitorAlert.model');
const { MAPS_ALERT_THRESHOLDS, MONGODB_ALERT_PCT } = require('./constants');

async function upsertAlert({
    service,
    code,
    severity,
    title,
    message,
    threshold = null,
    value = null,
}) {
    const fingerprint = `${service}:${code}`;
    const existing = await ServiceMonitorAlert.findOne({ fingerprint });
    if (existing && !existing.resolved) {
        existing.value = value;
        existing.message = message;
        existing.severity = severity;
        await existing.save();
        return existing;
    }
    if (existing && existing.resolved) {
        existing.resolved = false;
        existing.resolvedAt = null;
        existing.acknowledged = false;
        existing.acknowledgedAt = null;
        existing.title = title;
        existing.message = message;
        existing.severity = severity;
        existing.threshold = threshold;
        existing.value = value;
        await existing.save();
        return existing;
    }
    return ServiceMonitorAlert.create({
        service,
        code,
        severity,
        title,
        message,
        threshold,
        value,
        fingerprint,
    });
}

async function resolveAlert(service, code) {
    const fingerprint = `${service}:${code}`;
    await ServiceMonitorAlert.updateOne(
        { fingerprint, resolved: false },
        { $set: { resolved: true, resolvedAt: new Date() } }
    );
}

async function evaluateMapsSkuAlerts(sku, label, percent) {
    if (percent == null) return;
    for (const t of MAPS_ALERT_THRESHOLDS) {
        const code = `maps_${sku}_${t}`;
        if (percent >= t) {
            const severity = t >= 90 ? 'critical' : t >= 75 ? 'warning' : 'info';
            await upsertAlert({
                service: 'google_maps',
                code,
                severity,
                title: `Google Maps — ${label} em ${t}%`,
                message: `${label} consumiu ${percent}% do limite gratuito mensal estimado.`,
                threshold: t,
                value: percent,
            });
        } else {
            await resolveAlert('google_maps', code);
        }
    }
}

async function evaluateResourceAlert(service, metric, percent, label) {
    const code = `${metric}_high`;
    if (percent != null && percent >= MONGODB_ALERT_PCT) {
        await upsertAlert({
            service,
            code,
            severity: percent >= 95 ? 'critical' : 'warning',
            title: `${label} acima de ${MONGODB_ALERT_PCT}%`,
            message: `${label} em ${percent}%.`,
            threshold: MONGODB_ALERT_PCT,
            value: percent,
        });
    } else {
        await resolveAlert(service, code);
    }
}

async function listActiveAlerts(limit = 50) {
    return ServiceMonitorAlert.find({ resolved: false })
        .sort({ severity: -1, updatedAt: -1 })
        .limit(limit)
        .lean();
}

async function acknowledgeAlert(id) {
    return ServiceMonitorAlert.findByIdAndUpdate(
        id,
        { acknowledged: true, acknowledgedAt: new Date() },
        { new: true }
    ).lean();
}

module.exports = {
    upsertAlert,
    resolveAlert,
    evaluateMapsSkuAlerts,
    evaluateResourceAlert,
    listActiveAlerts,
    acknowledgeAlert,
};
