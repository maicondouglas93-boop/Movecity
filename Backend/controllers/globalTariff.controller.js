const globalTariffService = require('../services/globalTariff.service');

module.exports.list = async (req, res, next) => {
    try {
        const items = await globalTariffService.list();
        res.status(200).json(items);
    } catch (error) {
        next(error);
    }
};

module.exports.create = async (req, res, next) => {
    try {
        const item = await globalTariffService.create(req.body || {});
        res.status(201).json(item);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.update = async (req, res, next) => {
    try {
        const item = await globalTariffService.update(req.params.id, req.body || {});
        res.status(200).json(item);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.setActive = async (req, res, next) => {
    try {
        const active = req.body?.active;
        if (active === undefined) {
            return res.status(400).json({ message: 'Campo active é obrigatório' });
        }
        const item = await globalTariffService.setActive(req.params.id, active);
        res.status(200).json(item);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
};

module.exports.remove = async (req, res, next) => {
    try {
        const result = await globalTariffService.remove(req.params.id);
        res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
};
