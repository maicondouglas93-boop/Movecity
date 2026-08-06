import axios from 'axios'
import { App } from '@capacitor/app'
import { isNativePlatform } from '@/shared/platform/platform'
import { AppUpdate } from '@/shared/platform/appUpdate.native'
import { compareSemver, evaluateUpdate } from '@/shared/platform/appUpdate.logic'

export { compareSemver, evaluateUpdate }

const CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 min
const STORAGE_LAST_CHECK = 'driverAppUpdate_lastCheck'
const STORAGE_MIN_GATE = 'driverAppUpdate_minGate'
const STORAGE_DISMISSED = 'driverAppUpdate_dismissedCode'

function logUpdate(event, extra = {}) {
    try {
        // Sem tokens/senhas — só metadados de versão/download
        console.info(`[AppUpdate] ${event}`, extra)
    } catch {
        /* ignore */
    }
}

export async function getInstalledVersion() {
    if (isNativePlatform()) {
        try {
            const native = await AppUpdate.getInstalledVersion()
            return {
                versionName: native.versionName || '',
                versionCode: Number(native.versionCode) || 0,
                packageName: native.packageName || '',
                source: 'native',
            }
        } catch (e) {
            logUpdate('getInstalledVersion native falhou', { message: e?.message })
        }
        try {
            const info = await App.getInfo()
            return {
                versionName: info.version || '',
                versionCode: Number(info.build) || 0,
                packageName: info.id || '',
                source: 'capacitor-app',
            }
        } catch {
            /* fallthrough */
        }
    }
    return {
        versionName: import.meta.env.VITE_APP_VERSION || '0.0.0',
        versionCode: 0,
        packageName: 'web',
        source: 'web',
    }
}

async function fetchRemoteVersion() {
    const base = (import.meta.env.VITE_BASE_URL || '').replace(/\/+$/, '')
    const url = `${base}/api/app-version/driver`
    const { data } = await axios.get(url, { timeout: 12000 })
    return data
}

function readLastCheck() {
    try {
        return Number(localStorage.getItem(STORAGE_LAST_CHECK) || 0)
    } catch {
        return 0
    }
}

function writeLastCheck() {
    try {
        localStorage.setItem(STORAGE_LAST_CHECK, String(Date.now()))
    } catch {
        /* ignore */
    }
}

function saveMinGate(remote) {
    try {
        localStorage.setItem(
            STORAGE_MIN_GATE,
            JSON.stringify({
                minimumVersion: remote.minimumVersion,
                minimumVersionCode: remote.minimumVersionCode,
                version: remote.version,
                versionCode: remote.versionCode,
                apkUrl: remote.apkUrl,
                sha256: remote.sha256,
                fileSize: remote.fileSize,
                mandatory: remote.mandatory,
                releaseNotes: remote.releaseNotes,
                savedAt: Date.now(),
            }),
        )
    } catch {
        /* ignore */
    }
}

function readMinGate() {
    try {
        const raw = localStorage.getItem(STORAGE_MIN_GATE)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

function wasDismissed(versionCode) {
    try {
        return Number(localStorage.getItem(STORAGE_DISMISSED) || 0) === Number(versionCode)
    } catch {
        return false
    }
}

export function dismissOptionalUpdate(versionCode) {
    try {
        localStorage.setItem(STORAGE_DISMISSED, String(versionCode))
    } catch {
        /* ignore */
    }
}

/**
 * @param {{ force?: boolean }} opts force=true ignora throttle (botão manual)
 */
export async function checkForUpdate({ force = false } = {}) {
    const installed = await getInstalledVersion()
    logUpdate('verificação', {
        installedVersion: installed.versionName,
        installedCode: installed.versionCode,
        force,
    })

    const last = readLastCheck()
    if (!force && last && Date.now() - last < CHECK_INTERVAL_MS) {
        const cached = readMinGate()
        if (cached) {
            const evalCached = evaluateUpdate(installed, { ...cached, isActive: true })
            if (evalCached.mandatory) {
                return {
                    ok: true,
                    fromCache: true,
                    installed,
                    remote: cached,
                    ...evalCached,
                }
            }
        }
        return {
            ok: true,
            skipped: true,
            installed,
            available: false,
            mandatory: false,
            reason: 'throttled',
        }
    }

    try {
        const remote = await fetchRemoteVersion()
        writeLastCheck()
        saveMinGate(remote)
        const evaluation = evaluateUpdate(installed, remote)
        logUpdate('versão disponível', {
            remoteVersion: remote.version,
            remoteCode: remote.versionCode,
            available: evaluation.available,
            mandatory: evaluation.mandatory,
        })

        if (
            evaluation.available
            && !evaluation.mandatory
            && wasDismissed(remote.versionCode)
            && !force
        ) {
            return {
                ok: true,
                installed,
                remote,
                available: false,
                mandatory: false,
                reason: 'dismissed',
            }
        }

        return { ok: true, installed, remote, ...evaluation }
    } catch (error) {
        logUpdate('verificação falhou', { message: error?.message })
        const cached = readMinGate()
        if (cached) {
            const evaluation = evaluateUpdate(installed, { ...cached, isActive: true })
            if (evaluation.mandatory) {
                return {
                    ok: false,
                    offline: true,
                    installed,
                    remote: cached,
                    ...evaluation,
                    error: error?.message,
                }
            }
        }
        return {
            ok: false,
            offline: true,
            installed,
            available: false,
            mandatory: false,
            error: error?.message || 'Falha na verificação',
        }
    }
}

export function addDownloadProgressListener(callback) {
    if (!isNativePlatform()) return { remove: () => {} }
    const handle = AppUpdate.addListener('downloadProgress', callback)
    return {
        remove: () => {
            handle?.then?.((h) => h.remove())
            handle?.remove?.()
        },
    }
}

export async function downloadAndInstall(remote, { onProgress } = {}) {
    if (!isNativePlatform()) {
        throw new Error('Atualização nativa só no Android')
    }
    if (!remote?.apkUrl) throw new Error('URL do APK ausente')

    logUpdate('download iniciado', { version: remote.version, versionCode: remote.versionCode })
    const progressSub = onProgress ? addDownloadProgressListener(onProgress) : null

    try {
        const result = await AppUpdate.downloadAndInstall({
            apkUrl: remote.apkUrl,
            sha256: remote.sha256 || '',
            fileSize: Number(remote.fileSize) || 0,
        })

        if (result?.needsInstallPermission) {
            logUpdate('precisa permissão instalar')
            await AppUpdate.openInstallPermissionSettings()
            return { needsPermission: true, localPath: result.localPath }
        }

        logUpdate('download concluído / instalador aberto', { path: result?.localPath })
        return { opened: true, ...result }
    } catch (e) {
        logUpdate('download falhou', { message: e?.message })
        throw e
    } finally {
        progressSub?.remove?.()
    }
}

export async function resumeInstall(localPath) {
    if (!isNativePlatform()) throw new Error('Somente Android')
    const can = await AppUpdate.canInstallPackages()
    if (!can?.canInstall) {
        await AppUpdate.openInstallPermissionSettings()
        return { needsPermission: true }
    }
    await AppUpdate.installLocalApk({ localPath })
    return { opened: true }
}

export async function openApkFallback(apkUrl) {
    if (!apkUrl) return
    window.open(apkUrl, '_blank', 'noopener,noreferrer')
}

export async function cancelDownload() {
    if (!isNativePlatform()) return
    try {
        await AppUpdate.cancelDownload()
    } catch {
        /* ignore */
    }
}
