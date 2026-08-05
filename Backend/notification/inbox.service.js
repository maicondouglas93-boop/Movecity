const Notification = require('../models/notification.model');
const { toInboxDTO, resolveMeta, CATEGORY } = require('./notificationMeta');

function ownerFilter(req) {
    if (req.user) return { userId: req.user._id };
    if (req.captain) return { captainId: req.captain._id };
    return null;
}

function recipientScope(req) {
    if (req.user) return { userId: req.user._id, recipientType: 'passenger' };
    if (req.captain) return { captainId: req.captain._id, recipientType: 'driver' };
    return null;
}

/**
 * Lista paginada da central (mais recente → mais antiga).
 * Filtros: category, unreadOnly, cursor (createdAt ISO) ou page/limit.
 */
async function listInbox(req, { limit = 30, category, unreadOnly, cursor } = {}) {
    const filter = ownerFilter(req);
    if (!filter) throw Object.assign(new Error('Unauthorized'), { status: 401 });

    // Só mostra notificações endereçadas a este destinatário (ignora broadcasts
    // legados sem userId/captainId — aqueles eram só histórico de push admin).
    const query = { ...filter };
    if (category && category !== 'all') query.category = category;
    if (unreadOnly) query.read = false;
    if (cursor) {
        const cursorDate = new Date(cursor);
        if (!Number.isNaN(cursorDate.getTime())) query.createdAt = { $lt: cursorDate };
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const docs = await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(safeLimit + 1)
        .lean();

    const hasMore = docs.length > safeLimit;
    const items = hasMore ? docs.slice(0, safeLimit) : docs;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    return {
        items: items.map(toInboxDTO),
        nextCursor,
        hasMore,
    };
}

async function unreadCount(req) {
    const filter = ownerFilter(req);
    if (!filter) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    const count = await Notification.countDocuments({ ...filter, read: false });
    return { count };
}

async function markRead(req, id) {
    const filter = ownerFilter(req);
    if (!filter) throw Object.assign(new Error('Unauthorized'), { status: 401 });

    const doc = await Notification.findOneAndUpdate(
        { _id: id, ...filter },
        { $set: { read: true, readAt: new Date() } },
        { new: true }
    );
    if (!doc) throw Object.assign(new Error('Notificação não encontrada'), { status: 404 });
    return toInboxDTO(doc);
}

async function markAllRead(req) {
    const filter = ownerFilter(req);
    if (!filter) throw Object.assign(new Error('Unauthorized'), { status: 401 });

    const result = await Notification.updateMany(
        { ...filter, read: false },
        { $set: { read: true, readAt: new Date() } }
    );
    return { modified: result.modifiedCount || 0 };
}

async function deleteOne(req, id) {
    const filter = ownerFilter(req);
    if (!filter) throw Object.assign(new Error('Unauthorized'), { status: 401 });

    const doc = await Notification.findOneAndDelete({ _id: id, ...filter });
    if (!doc) throw Object.assign(new Error('Notificação não encontrada'), { status: 404 });
    return { deleted: true };
}

async function clearRead(req) {
    const filter = ownerFilter(req);
    if (!filter) throw Object.assign(new Error('Unauthorized'), { status: 401 });

    const result = await Notification.deleteMany({ ...filter, read: true });
    return { deleted: result.deletedCount || 0 };
}

/**
 * Cria registro(s) de inbox + opcionalmente dispara push (via dispatcher).
 * Usado pelo painel admin POST /notifications/admin e por helpers internos.
 */
async function createInboxNotifications({
    recipients, // [{ userId }] | [{ captainId }]
    title,
    message,
    type = 'ADMIN',
    category,
    priority,
    icon,
    action,
    referenceId,
    referenceType,
    origin = 'admin',
    campaignId = null,
}) {
    if (!recipients?.length) return [];

    const meta = resolveMeta({ type, category, priority, icon, action, data: { deepLink: action, referenceId, referenceType } });
    const now = new Date();
    const docs = recipients.map((r) => ({
        userId: r.userId || undefined,
        captainId: r.captainId || undefined,
        recipientType: r.userId ? 'passenger' : r.captainId ? 'driver' : null,
        title,
        message,
        type,
        category: meta.category,
        priority: meta.priority,
        icon: meta.icon,
        action: meta.action,
        referenceId: referenceId || meta.referenceId,
        referenceType: referenceType || meta.referenceType,
        origin,
        campaignId,
        targetAudience: 'specific',
        status: 'sent',
        sentAt: now,
        read: false,
    }));

    const created = await Notification.insertMany(docs, { ordered: false });
    return created.map(toInboxDTO);
}

module.exports = {
    listInbox,
    unreadCount,
    markRead,
    markAllRead,
    deleteOne,
    clearRead,
    createInboxNotifications,
    ownerFilter,
    recipientScope,
    CATEGORY,
};
