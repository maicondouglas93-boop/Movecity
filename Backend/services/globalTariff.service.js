const GlobalTariff = require('../models/globalTariff.model');

function assertValidPayload(payload = {}, { partial = false } = {}) {
    const next = {};

    if (payload.name !== undefined || !partial) {
        const name = String(payload.name ?? '').trim();
        if (!name) {
            const err = new Error('Nome da tarifa global é obrigatório');
            err.statusCode = 400;
            throw err;
        }
        if (name.length > 120) {
            const err = new Error('Nome deve ter no máximo 120 caracteres');
            err.statusCode = 400;
            throw err;
        }
        next.name = name;
    }

    if (payload.value !== undefined || !partial) {
        const value = Number(payload.value);
        if (!Number.isFinite(value)) {
            const err = new Error('Valor deve ser numérico');
            err.statusCode = 400;
            throw err;
        }
        if (value < 0) {
            const err = new Error('Valor não pode ser negativo');
            err.statusCode = 400;
            throw err;
        }
        next.value = value;
    }

    if (payload.active !== undefined) {
        next.active = Boolean(payload.active);
    }

    return next;
}

function toDTO(doc) {
    const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    return {
        _id: plain._id,
        name: plain.name,
        value: plain.value,
        active: Boolean(plain.active),
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
    };
}

module.exports.list = async () => {
    const items = await GlobalTariff.find().sort({ createdAt: -1 });
    return items.map(toDTO);
};

module.exports.getById = async (id) => {
    const doc = await GlobalTariff.findById(id);
    return doc ? toDTO(doc) : null;
};

/** Lista leve para o PricingEngine (só ativas). */
module.exports.listActiveForPricing = async () => {
    const items = await GlobalTariff.find({ active: true })
        .select('_id name value')
        .sort({ createdAt: 1 })
        .lean();
    return items.map((t) => ({
        _id: String(t._id),
        name: t.name,
        value: Number(t.value) || 0,
    }));
};

module.exports.create = async (payload) => {
    const data = assertValidPayload(payload, { partial: false });
    if (data.active === undefined) data.active = true;
    const doc = await GlobalTariff.create(data);
    return toDTO(doc);
};

module.exports.update = async (id, payload) => {
    const doc = await GlobalTariff.findById(id);
    if (!doc) {
        const err = new Error('Tarifa global não encontrada');
        err.statusCode = 404;
        throw err;
    }
    const data = assertValidPayload(payload, { partial: true });
    if (data.name !== undefined) doc.name = data.name;
    if (data.value !== undefined) doc.value = data.value;
    if (data.active !== undefined) doc.active = data.active;
    await doc.save();
    return toDTO(doc);
};

module.exports.setActive = async (id, active) => {
    return module.exports.update(id, { active: Boolean(active) });
};

module.exports.remove = async (id) => {
    const doc = await GlobalTariff.findByIdAndDelete(id);
    if (!doc) {
        const err = new Error('Tarifa global não encontrada');
        err.statusCode = 404;
        throw err;
    }
    return { ok: true, _id: id };
};

module.exports.toDTO = toDTO;
