/** Comparação semântica correta (1.9.0 < 1.10.0). */
export function compareSemver(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0)
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0)
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i += 1) {
        const da = pa[i] || 0
        const db = pb[i] || 0
        if (da > db) return 1
        if (da < db) return -1
    }
    return 0
}

/**
 * Avalia se há update e se é obrigatório.
 * Preferência: versionCode (Android). Fallback: semver.
 */
export function evaluateUpdate(installed, remote) {
    if (!remote || !remote.isActive) {
        return { available: false, mandatory: false, reason: 'inactive' }
    }
    if (!remote.apkUrl) {
        return { available: false, mandatory: false, reason: 'no-apk-url' }
    }

    const installedCode = Number(installed.versionCode) || 0
    const remoteCode = Number(remote.versionCode) || 0
    const minCode = Number(remote.minimumVersionCode) || 0

    let available = false
    if (installedCode > 0 && remoteCode > 0) {
        available = remoteCode > installedCode
    } else {
        available = compareSemver(remote.version, installed.versionName) > 0
    }

    let belowMinimum = false
    if (installedCode > 0 && minCode > 0) {
        belowMinimum = installedCode < minCode
    } else if (remote.minimumVersion) {
        belowMinimum = compareSemver(installed.versionName, remote.minimumVersion) < 0
    }

    const mandatory = Boolean(remote.mandatory) || belowMinimum

    return {
        available: available || mandatory,
        mandatory,
        belowMinimum,
        reason: mandatory ? (belowMinimum ? 'below-minimum' : 'mandatory-flag') : available ? 'newer' : 'up-to-date',
    }
}
