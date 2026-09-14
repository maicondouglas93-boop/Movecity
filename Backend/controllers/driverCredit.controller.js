const creditService = require('../services/driverCredit.service');
const adminService = require('../services/admin.service');

exports.getSetting = async (req, res, next) => {
    try { res.json(await creditService.getDriverCreditSetting()); } catch (error) { next(error); }
};

exports.updateSetting = async (req, res, next) => {
    try {
        const setting = await creditService.updateDriverCreditSetting(req.body || {});
        await adminService.logAction({
            adminId: req.admin._id, adminName: req.admin.name,
            action: 'update_driver_credit_rule', targetModel: 'GlobalSetting',
            reason: 'Atualização do bloqueio por crédito negativo',
            newValue: setting, ipAddress: req.ip,
        });
        res.json(setting);
    } catch (error) {
        if ([400, 409].includes(error.statusCode) || error.name === 'VersionError') {
            return res.status(error.statusCode || 409).json({ message: error.message });
        }
        next(error);
    }
};
