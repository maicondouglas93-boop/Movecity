const { validationResult } = require('express-validator');
const scheduleService = require('../services/schedule.service');

module.exports.listMine = async (req, res) => {
    try {
        const scheduled = await scheduleService.listUserScheduled(req.user._id);
        return res.status(200).json({ scheduled });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports.cancelMine = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const kind = req.body.kind || req.params.kind;
        const id = req.body.id || req.params.id;
        const result = await scheduleService.cancelUserScheduled({
            userId: req.user._id,
            kind,
            id,
        });
        return res.status(200).json(result);
    } catch (err) {
        if (err.code === 'SCHEDULED_NOT_FOUND') {
            return res.status(404).json({ message: 'Agendamento não encontrado' });
        }
        if (err.code === 'INVALID_KIND') {
            return res.status(400).json({ message: 'Tipo inválido (ride ou parcel)' });
        }
        if (err.code === 'CANCELLATION_IN_PROGRESS') {
            return res.status(409).json({ code: err.code, message: 'Cancelamento já está sendo processado.' });
        }
        if (err.code === 'CANCELLATION_RETRY_REQUIRED') {
            return res.status(503).json({ code: err.code, message: 'O cancelamento financeiro está pendente. Tente novamente.' });
        }
        return res.status(500).json({ message: err.message });
    }
};

module.exports.listCaptainUpcoming = async (req, res) => {
    try {
        const upcoming = await scheduleService.listCaptainUpcoming(req.captain?._id);
        return res.status(200).json({ upcoming });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};
