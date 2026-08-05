const SERVICE_KINDS = ['ride', 'presential', 'parcel'];
const DEFAULT_COMMISSION = 20;

function clampCommission(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, n));
}

/**
 * Resolve % de comissão da plataforma por tipo de serviço.
 * 1) platformCommissions[kind]
 * 2) platformCommission legado
 * 3) 20
 */
function resolvePlatformCommission(globalSetting, kind = 'ride') {
    const key = SERVICE_KINDS.includes(kind) ? kind : 'ride';
    const nested = globalSetting?.platformCommissions?.[key];
    const fromNested = clampCommission(nested);
    if (fromNested != null) return fromNested;

    const fromLegacy = clampCommission(globalSetting?.platformCommission);
    if (fromLegacy != null) return fromLegacy;

    return DEFAULT_COMMISSION;
}

function buildPlatformCommissionsFromLegacy(globalSetting = {}, { forceLegacy = false } = {}) {
    const legacy = clampCommission(globalSetting.platformCommission) ?? DEFAULT_COMMISSION;
    const current = globalSetting.platformCommissions?.toObject?.()
        || globalSetting.platformCommissions
        || {};
    if (forceLegacy) {
        return { ride: legacy, presential: legacy, parcel: legacy };
    }
    return {
        ride: clampCommission(current.ride) ?? legacy,
        presential: clampCommission(current.presential) ?? legacy,
        parcel: clampCommission(current.parcel) ?? legacy,
    };
}

function hasCompletePlatformCommissions(globalSetting) {
    const block = globalSetting?.platformCommissions;
    if (!block) return false;
    return SERVICE_KINDS.every((k) => Number.isFinite(Number(block[k])));
}

/**
 * Garante platformCommissions no documento (migração lazy).
 * Sincroniza platformCommission legado = ride.
 *
 * Caso especial: create({ platformCommission: 25 }) faz o Mongoose preencher
 * nested com defaults (20). Se nested está todo no default e o legado diverge,
 * reconstrói a partir do legado (não sobrescreve o valor admin antigo).
 */
async function ensurePlatformCommissions(globalSetting) {
    if (!globalSetting) return null;

    const legacy = clampCommission(globalSetting.platformCommission);
    const rawBlock = globalSetting.platformCommissions;
    const block = rawBlock?.toObject?.() || rawBlock || null;
    const complete = hasCompletePlatformCommissions({ platformCommissions: block });

    if (complete) {
        const rideNested = Number(block.ride);
        // Nested uniforme (ex.: defaults 20/20/20 do schema) + legado diferente
        // → doc antigo: reconstrói a partir do legado.
        const nestedUniform = SERVICE_KINDS.every((k) => Number(block[k]) === rideNested);
        if (legacy != null && nestedUniform && legacy !== rideNested) {
            // forceLegacy: nested veio de defaults do schema, não de escolha do admin.
            const migrated = buildPlatformCommissionsFromLegacy(globalSetting, { forceLegacy: true });
            globalSetting.platformCommissions = migrated;
            globalSetting.platformCommission = migrated.ride;
            globalSetting.markModified('platformCommissions');
            await globalSetting.save();
            return globalSetting;
        }

        if (Number(globalSetting.platformCommission) !== rideNested) {
            globalSetting.platformCommission = rideNested;
            await globalSetting.save();
        }
        return globalSetting;
    }

    const migrated = buildPlatformCommissionsFromLegacy(globalSetting);
    globalSetting.platformCommissions = migrated;
    globalSetting.platformCommission = migrated.ride;
    globalSetting.markModified('platformCommissions');
    await globalSetting.save();
    return globalSetting;
}

function normalizePlatformCommissionsPatch(patch = {}, current = {}) {
    const base = buildPlatformCommissionsFromLegacy(current);
    const next = { ...base };

    if (patch.platformCommissions && typeof patch.platformCommissions === 'object') {
        for (const key of SERVICE_KINDS) {
            if (patch.platformCommissions[key] !== undefined && patch.platformCommissions[key] !== null && patch.platformCommissions[key] !== '') {
                const clamped = clampCommission(patch.platformCommissions[key]);
                if (clamped != null) next[key] = clamped;
            }
        }
    }

    // Patch legado: atualiza só ride (e sync legado), preserva presential/parcel já migrados.
    if (patch.platformCommission !== undefined && patch.platformCommission !== null && patch.platformCommission !== '') {
        const clamped = clampCommission(patch.platformCommission);
        if (clamped != null) next.ride = clamped;
    }

    return next;
}

module.exports = {
    SERVICE_KINDS,
    DEFAULT_COMMISSION,
    resolvePlatformCommission,
    buildPlatformCommissionsFromLegacy,
    hasCompletePlatformCommissions,
    ensurePlatformCommissions,
    normalizePlatformCommissionsPatch,
    clampCommission,
};
