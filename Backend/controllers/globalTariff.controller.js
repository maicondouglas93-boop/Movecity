const globalTariffService = require('../services/globalTariff.service');
const adminService = require('../services/admin.service');

module.exports.list = async (req, res, next) => {
    try {
        const items = await globalTariffService.list();
        res.status(200).json(items);
    } catch (error) {
        next(error);
    }
};

// Auditoria de UX/produção (2026-08-10, achado A5): "Tarifas Globais" era a única tela
// de mutação do painel sem nenhum rastro em AdminLog — create/update/setActive/remove
// aqui mudam valores que entram direto no cálculo de tarifa (PricingEngine), mas
// ninguém conseguia ver quem mudou o quê. Segue o mesmo padrão já usado em
// updateVehicleCategory/updatePromotionStatus (oldValue/newValue em AdminLog).
module.exports.create = async (req, res, next) => {
    try {
        const item = await globalTariffService.create(req.body || {});

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'create_global_tariff',
            targetId: item._id.toString(),
            targetModel: 'GlobalTariff',
            reason: `Tarifa global "${item.name}" criada`,
            newValue: item,
            ipAddress: req.ip
        });

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
        const oldValue = await globalTariffService.getById(req.params.id);
        const item = await globalTariffService.update(req.params.id, req.body || {});

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'update_global_tariff',
            targetId: item._id.toString(),
            targetModel: 'GlobalTariff',
            reason: `Tarifa global "${item.name}" atualizada`,
            oldValue,
            newValue: item,
            ipAddress: req.ip
        });

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
        const oldValue = await globalTariffService.getById(req.params.id);
        const item = await globalTariffService.setActive(req.params.id, active);

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'update_global_tariff',
            targetId: item._id.toString(),
            targetModel: 'GlobalTariff',
            reason: `Tarifa global "${item.name}" ${item.active ? 'ativada' : 'desativada'}`,
            oldValue,
            newValue: item,
            ipAddress: req.ip
        });

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
        const oldValue = await globalTariffService.getById(req.params.id);
        const result = await globalTariffService.remove(req.params.id);

        await adminService.logAction({
            adminId: req.admin._id,
            adminName: req.admin.name,
            action: 'delete_global_tariff',
            targetId: req.params.id,
            targetModel: 'GlobalTariff',
            reason: oldValue ? `Tarifa global "${oldValue.name}" removida` : 'Tarifa global removida',
            oldValue,
            ipAddress: req.ip
        });

        res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
};
