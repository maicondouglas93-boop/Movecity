const driverAppVersionService = require('../services/driverAppVersion.service');

module.exports.getDriverAppVersion = async (req, res, next) => {
    try {
        const data = await driverAppVersionService.getPublic();
        if (!data.isActive) {
            return res.status(200).json({
                ...data,
                apkUrl: '',
                mandatory: false,
            });
        }
        return res.status(200).json(data);
    } catch (error) {
        return next(error);
    }
};

module.exports.getAdminDriverAppVersion = async (req, res, next) => {
    try {
        const data = await driverAppVersionService.getPublic();
        return res.status(200).json(data);
    } catch (error) {
        return next(error);
    }
};

module.exports.updateAdminDriverAppVersion = async (req, res, next) => {
    try {
        const data = await driverAppVersionService.update(req.body || {});
        return res.status(200).json(data);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return next(error);
    }
};
