const adminUserModel = require('../models/adminUser.model');
const authService = require('../services/auth.service');
const { resolveAccessToken } = require('../utils/authToken');

module.exports.authAdmin = async (req, res, next) => {
    const { token, source } = resolveAccessToken(req, ['adminAccessToken', 'adminToken']);

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    req.authToken = token;
    req.authSource = source;

    try {
        const decoded = authService.verifyAccessToken(token, 'admin');
        const admin = await adminUserModel.findById(decoded.subjectId);

        if (!admin || !admin.active) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        req.admin = admin;
        req.auth = decoded;

        return next();

    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
};

module.exports.authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(403).json({ message: 'Forbidden: No admin context' });
        }
        if (req.admin.role === 'OWNER') {
            return next();
        }
        if (!allowedRoles.includes(req.admin.role)) {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to perform this action' });
        }
        next();
    };
};
