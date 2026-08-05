/**
 * Metadados da central de notificações (inbox in-app).
 * Mapeia o `type` legado do push para categoria, ícone, prioridade e ação.
 */

const CATEGORY = {
    RIDE: 'ride',
    PARCEL: 'parcel',
    SCHEDULE: 'schedule',
    PROMOTION: 'promotion',
    COUPON: 'coupon',
    ADMIN: 'admin',
    PAYMENT: 'payment',
    SYSTEM: 'system',
    ALERT: 'alert',
};

const ICONS = {
    [CATEGORY.RIDE]: '🚖',
    [CATEGORY.PARCEL]: '📦',
    [CATEGORY.SCHEDULE]: '📅',
    [CATEGORY.PROMOTION]: '🎁',
    [CATEGORY.COUPON]: '🏷️',
    [CATEGORY.ADMIN]: '🛡️',
    [CATEGORY.PAYMENT]: '💳',
    [CATEGORY.SYSTEM]: '⚙️',
    [CATEGORY.ALERT]: '🔔',
};

const TYPE_META = {
    NEW_RIDE: { category: CATEGORY.RIDE, priority: 'high', action: '/captain-home' },
    NEW_PARCEL: { category: CATEGORY.PARCEL, priority: 'high', action: '/captain-home' },
    RIDE_ACCEPTED: { category: CATEGORY.RIDE, priority: 'high', action: '/riding' },
    RIDE_STARTED: { category: CATEGORY.RIDE, priority: 'high', action: '/riding' },
    RIDE_FINISHED: { category: CATEGORY.RIDE, priority: 'high', action: '/riding' },
    RIDE_ARRIVED: { category: CATEGORY.RIDE, priority: 'high', action: '/riding' },
    RIDE_CANCELLED: { category: CATEGORY.RIDE, priority: 'high', action: '/home' },
    CHAT: { category: CATEGORY.ALERT, priority: 'normal', action: null },
    PAYMENT: { category: CATEGORY.PAYMENT, priority: 'normal', action: '/captain-home' },
    PROMOTION: { category: CATEGORY.PROMOTION, priority: 'low', action: '/coupons' },
    ADMIN: { category: CATEGORY.ADMIN, priority: 'normal', action: '/home' },
    RECHARGE: { category: CATEGORY.PAYMENT, priority: 'normal', action: '/captain/wallet' },
    DOCUMENT: { category: CATEGORY.ADMIN, priority: 'high', action: '/captain/profile' },
    SCHEDULE_CREATED: { category: CATEGORY.SCHEDULE, priority: 'normal', action: '/scheduled' },
    SCHEDULE_ACTIVATED: { category: CATEGORY.SCHEDULE, priority: 'high', action: '/home' },
    SCHEDULE_NO_DRIVER: { category: CATEGORY.SCHEDULE, priority: 'high', action: '/scheduled' },
    SCHEDULE_REMINDER: { category: CATEGORY.SCHEDULE, priority: 'normal', action: '/scheduled' },
    COUPON: { category: CATEGORY.COUPON, priority: 'normal', action: '/coupons' },
    SYSTEM: { category: CATEGORY.SYSTEM, priority: 'normal', action: '/home' },
    ALERT: { category: CATEGORY.ALERT, priority: 'high', action: null },
};

function resolveMeta({ type, data = {}, category, priority, icon, action } = {}) {
    const fromType = TYPE_META[type] || { category: CATEGORY.SYSTEM, priority: 'normal', action: null };
    const resolvedCategory = category || fromType.category;
    const deepLink = data.deepLink || action || fromType.action || null;

    let referenceId = data.rideId || data.parcelId || data.referenceId || data.transactionId || null;
    let referenceType = null;
    if (data.rideId) referenceType = 'ride';
    else if (data.parcelId) referenceType = 'parcel';
    else if (data.transactionId) referenceType = 'transaction';
    else if (data.referenceType) referenceType = data.referenceType;

    return {
        category: resolvedCategory,
        priority: priority || fromType.priority || 'normal',
        icon: icon || ICONS[resolvedCategory] || ICONS[CATEGORY.ALERT],
        action: deepLink,
        referenceId: referenceId ? String(referenceId) : null,
        referenceType,
    };
}

function toInboxDTO(doc) {
    if (!doc) return null;
    const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return {
        id: plain._id?.toString?.() || plain.id,
        userId: plain.userId?.toString?.() || plain.userId || null,
        captainId: plain.captainId?.toString?.() || plain.captainId || null,
        recipientType: plain.recipientType
            || (plain.userId ? 'passenger' : plain.captainId ? 'driver' : null),
        tipoUsuario: plain.recipientType
            || (plain.userId ? 'passenger' : plain.captainId ? 'driver' : null),
        category: plain.category || resolveMeta({ type: plain.type }).category,
        categoria: plain.category || resolveMeta({ type: plain.type }).category,
        type: plain.type,
        title: plain.title,
        titulo: plain.title,
        description: plain.message,
        descricao: plain.message,
        message: plain.message,
        icon: plain.icon || resolveMeta({ type: plain.type, category: plain.category }).icon,
        icone: plain.icon || resolveMeta({ type: plain.type, category: plain.category }).icon,
        action: plain.action || null,
        acao: plain.action || null,
        referenceId: plain.referenceId || null,
        referenciaId: plain.referenceId || null,
        referenceType: plain.referenceType || null,
        priority: plain.priority || 'normal',
        prioridade: plain.priority || 'normal',
        origin: plain.origin || 'system',
        lida: Boolean(plain.read),
        read: Boolean(plain.read),
        readAt: plain.readAt || null,
        createdAt: plain.createdAt,
        sentAt: plain.sentAt || plain.createdAt,
        status: plain.status,
    };
}

module.exports = {
    CATEGORY,
    ICONS,
    TYPE_META,
    resolveMeta,
    toInboxDTO,
};
