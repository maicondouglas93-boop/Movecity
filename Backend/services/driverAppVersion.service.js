const DriverAppVersion = require('../models/driverAppVersion.model');

const DEFAULTS = {
    version: '1.1.0',
    versionCode: 2,
    minimumVersion: '1.0.0',
    minimumVersionCode: 1,
    apkUrl: '',
    sha256: '',
    fileSize: 0,
    mandatory: false,
    releaseNotes: [],
    isActive: true,
};

function assertHttpsUrl(url) {
    if (!url) return;
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        const err = new Error('apkUrl inválida');
        err.statusCode = 400;
        throw err;
    }
    if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
        const err = new Error('apkUrl deve usar HTTPS em produção');
        err.statusCode = 400;
        throw err;
    }
    const allow = (process.env.APK_ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
    if (allow.length > 0 && !allow.includes(parsed.hostname.toLowerCase())) {
        const err = new Error(`Host do APK não permitido: ${parsed.hostname}`);
        err.statusCode = 400;
        throw err;
    }
}

function toPublicDTO(doc) {
    return {
        version: doc.version,
        versionCode: doc.versionCode,
        minimumVersion: doc.minimumVersion,
        minimumVersionCode: doc.minimumVersionCode,
        apkUrl: doc.apkUrl || '',
        sha256: doc.sha256 || '',
        fileSize: doc.fileSize || 0,
        mandatory: Boolean(doc.mandatory),
        releaseNotes: Array.isArray(doc.releaseNotes) ? doc.releaseNotes : [],
        isActive: doc.isActive !== false,
        updatedAt: doc.updatedAt,
    };
}

module.exports.getOrCreate = async () => {
    let doc = await DriverAppVersion.findOne().sort({ updatedAt: -1 });
    if (!doc) {
        doc = await DriverAppVersion.create(DEFAULTS);
    }
    return doc;
};

module.exports.getPublic = async () => {
    const doc = await module.exports.getOrCreate();
    return toPublicDTO(doc);
};

module.exports.update = async (payload = {}) => {
    const doc = await module.exports.getOrCreate();
    const next = { ...payload };

    if (next.apkUrl !== undefined) {
        next.apkUrl = String(next.apkUrl || '').trim();
        assertHttpsUrl(next.apkUrl);
    }
    if (next.sha256 !== undefined) {
        next.sha256 = String(next.sha256 || '').trim().toLowerCase();
        if (next.sha256 && !/^[a-f0-9]{64}$/.test(next.sha256)) {
            const err = new Error('sha256 deve ter 64 caracteres hex');
            err.statusCode = 400;
            throw err;
        }
    }
    // APK publicado exige SHA-256 (update in-app bloqueia sem hash).
    const effectiveApkUrl = next.apkUrl !== undefined ? next.apkUrl : doc.apkUrl;
    const effectiveSha = next.sha256 !== undefined ? next.sha256 : doc.sha256;
    if (effectiveApkUrl) {
        if (!effectiveSha || !/^[a-f0-9]{64}$/.test(String(effectiveSha))) {
            const err = new Error('sha256 é obrigatório quando apkUrl está definido');
            err.statusCode = 400;
            throw err;
        }
    }
    if (next.releaseNotes !== undefined) {
        next.releaseNotes = Array.isArray(next.releaseNotes)
            ? next.releaseNotes.map((n) => String(n).trim()).filter(Boolean)
            : String(next.releaseNotes || '')
                .split('\n')
                .map((n) => n.replace(/^[-•*]\s*/, '').trim())
                .filter(Boolean);
    }
    if (next.versionCode !== undefined) next.versionCode = Number(next.versionCode);
    if (next.minimumVersionCode !== undefined) {
        next.minimumVersionCode = Number(next.minimumVersionCode);
    }
    if (next.fileSize !== undefined) next.fileSize = Number(next.fileSize) || 0;
    if (next.mandatory !== undefined) next.mandatory = Boolean(next.mandatory);
    if (next.isActive !== undefined) next.isActive = Boolean(next.isActive);

    Object.assign(doc, {
        version: next.version !== undefined ? String(next.version).trim() : doc.version,
        versionCode: Number.isFinite(next.versionCode) ? next.versionCode : doc.versionCode,
        minimumVersion: next.minimumVersion !== undefined
            ? String(next.minimumVersion).trim()
            : doc.minimumVersion,
        minimumVersionCode: Number.isFinite(next.minimumVersionCode)
            ? next.minimumVersionCode
            : doc.minimumVersionCode,
        apkUrl: next.apkUrl !== undefined ? next.apkUrl : doc.apkUrl,
        sha256: next.sha256 !== undefined ? next.sha256 : doc.sha256,
        fileSize: next.fileSize !== undefined ? next.fileSize : doc.fileSize,
        mandatory: next.mandatory !== undefined ? next.mandatory : doc.mandatory,
        releaseNotes: next.releaseNotes !== undefined ? next.releaseNotes : doc.releaseNotes,
        isActive: next.isActive !== undefined ? next.isActive : doc.isActive,
    });

    await doc.save();
    return toPublicDTO(doc);
};

module.exports.toPublicDTO = toPublicDTO;
