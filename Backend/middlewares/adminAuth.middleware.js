const jwt = require('jsonwebtoken');
const adminUserModel = require('../models/adminUser.model');
const { resolveAccessToken } = require('../utils/authToken');

module.exports.authAdmin = async (req, res, next) => {
    const { token, source } = resolveAccessToken(req, 'adminToken');

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    req.authToken = token;
    req.authSource = source;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const admin = await adminUserModel.findById(decoded._id);

        if (!admin || !admin.active) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        req.admin = admin;

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
