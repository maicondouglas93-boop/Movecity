const monitorService = require('../services/monitoring/monitor.service');

module.exports.getServicesDashboard = async (req, res, next) => {
    try {
        const force = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await monitorService.getDashboard({ force });
        res.status(200).json(data);
    } catch (err) {
        next(err);
    }
};

module.exports.getServicesStatus = async (req, res, next) => {
    try {
        const data = await monitorService.getStatusFast();
        res.status(200).json(data);
    } catch (err) {
        next(err);
    }
};

module.exports.getServiceDetail = async (req, res, next) => {
    try {
        const data = await monitorService.getServiceDetail(req.params.service);
        res.status(200).json(data);
    } catch (err) {
        if (err.statusCode === 404) return res.status(404).json({ message: err.message });
        next(err);
    }
};

module.exports.refreshServices = async (req, res, next) => {
    try {
        const data = await monitorService.getDashboard({ force: true });
        res.status(200).json(data);
    } catch (err) {
        next(err);
    }
};

module.exports.getMonitorAlerts = async (req, res, next) => {
    try {
        const alerts = await monitorService.listActiveAlerts(100);
        res.status(200).json({ alerts });
    } catch (err) {
        next(err);
    }
};

module.exports.acknowledgeMonitorAlert = async (req, res, next) => {
    try {
        const alert = await monitorService.acknowledgeAlert(req.params.id, req.admin);
        if (!alert) return res.status(404).json({ message: 'Alerta não encontrado' });
        res.status(200).json(alert);
    } catch (err) {
        next(err);
    }
};

module.exports.getMonitorAudit = async (req, res, next) => {
    try {
        const limit = Number(req.query.limit) || 50;
        const skip = Number(req.query.skip) || 0;
        const service = req.query.service || undefined;
        const data = await monitorService.getAuditLogs({ service, limit, skip });
        res.status(200).json(data);
    } catch (err) {
        next(err);
    }
};
