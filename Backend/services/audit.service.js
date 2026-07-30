const AuditLog = require('../models/auditLog.model');

module.exports.logAction = async (adminId, action, entity, entityId, details, ipAddress) => {
    try {
        await AuditLog.create({
            admin: adminId,
            action,
            entity,
            entityId,
            details,
            ipAddress
        });
    } catch (error) {
        console.error("Erro ao salvar log de auditoria:", error);
    }
};

module.exports.getLogs = async (limit = 100, skip = 0) => {
    return await AuditLog.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('admin', 'name email role');
};
