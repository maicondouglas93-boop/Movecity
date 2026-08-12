import { useCallback, useEffect, useRef, useState } from 'react'
import { isNativePlatform } from '@/shared/platform/platform'
import { onAppActive } from '@/shared/platform/appLifecycle.service'
import {
    checkForUpdate,
    dismissOptionalUpdate,
    downloadAndInstall,
    openApkFallback,
    resumeInstall,
    cancelDownload,
} from '@/shared/platform/appUpdate.service'

const IS_PLAY_BUILD = import.meta.env.VITE_DISTRIBUTION_CHANNEL === 'play'

/**
 * Verificação assíncrona de atualização do APK (não bloqueia o boot).
 * Só ativa no Capacitor Android (build motorista).
 */
export default function AppUpdateGate() {
    // A Play Store gerencia atualizações do AAB. O instalador próprio de APK fica
    // restrito ao canal sideload para não solicitar instalação de fontes externas.
    const [state, setState] = useState(null) // resultado check
    const [visible, setVisible] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const [percent, setPercent] = useState(0)
    const [error, setError] = useState('')
    const [localPath, setLocalPath] = useState('')
    const busyRef = useRef(false)

    const runCheck = useCallback(async ({ force = false } = {}) => {
        if (IS_PLAY_BUILD) return
        if (!isNativePlatform()) return
        if (busyRef.current && !force) return
        busyRef.current = true
        try {
            const result = await checkForUpdate({ force })
            if (result.available) {
                try {
                    const sessionDismissed = sessionStorage.getItem('driverAppUpdate_sessionDismissed')
                    if (
                        result.mandatory
                        && sessionDismissed
                        && Number(sessionDismissed) === Number(result.remote?.versionCode)
                        && !force
                    ) {
                        return
                    }
                } catch { /* ignore */ }
                setState(result)
                setVisible(true)
                setError('')
                return
            }
            if (force) {
                if (result.offline && !result.mandatory) {
                    setState({
                        ...result,
                        manualOffline: true,
                        installed: result.installed,
                        remote: result.remote || {},
                    })
                    setVisible(true)
                    return
                }
                if (result.ok || result.skipped) {
                    setState({ ...result, manualUpToDate: true })
                    setVisible(true)
                }
            }
        } finally {
            busyRef.current = false
        }
    }, [])

    useEffect(() => {
        if (IS_PLAY_BUILD) return undefined
        if (!isNativePlatform()) return undefined
        const t = setTimeout(() => {
            runCheck({ force: false })
        }, 800)
        const off = onAppActive(() => {
            runCheck({ force: false })
        })
        const onManual = () => runCheck({ force: true })
        window.addEventListener('movecity:check-app-update', onManual)
        return () => {
            clearTimeout(t)
            off?.()
            window.removeEventListener('movecity:check-app-update', onManual)
        }
    }, [runCheck])

    if (IS_PLAY_BUILD || !isNativePlatform() || !visible || !state) return null

    const remote = state.remote || {}
    const installed = state.installed || {}
    const mandatory = Boolean(state.mandatory)
    const upToDate = Boolean(state.manualUpToDate)
    const offlineMsg = Boolean(state.manualOffline)

    const onClose = () => {
        // Sempre permite fechar a UI — inclusive em "obrigatória".
        // Sem isso o motorista fica preso se o download falhar (ex.: tamanho).
        // Opcional: lembra no localStorage. Obrigatória: só nesta sessão do app.
        if (remote.versionCode) {
            if (mandatory) {
                try {
                    sessionStorage.setItem(
                        'driverAppUpdate_sessionDismissed',
                        String(remote.versionCode),
                    )
                } catch { /* ignore */ }
            } else {
                dismissOptionalUpdate(remote.versionCode)
            }
        }
        setVisible(false)
        setError('')
        setDownloading(false)
    }

    const onUpdate = async () => {
        setError('')
        setDownloading(true)
        setPercent(0)
        try {
            if (localPath) {
                const r = await resumeInstall(localPath)
                if (r.needsPermission) {
                    setError('Ative a permissão “Instalar apps desconhecidos” e toque novamente em Atualizar.')
                }
                return
            }
            const r = await downloadAndInstall(remote, {
                onProgress: (p) => setPercent(Number(p?.percent) || 0),
            })
            if (r.needsPermission) {
                setLocalPath(r.localPath || '')
                setError('Ative a permissão para instalar pacotes e toque novamente em Atualizar.')
            }
        } catch (e) {
            setError(e?.message || 'Falha ao baixar a atualização')
        } finally {
            setDownloading(false)
        }
    }

    const notes = Array.isArray(remote.releaseNotes) ? remote.releaseNotes : []

    return (
        <div
            className="fixed inset-0 z-[10050] flex items-end sm:items-center justify-center bg-ink-900/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-update-title"
        >
            <div className="w-full max-w-md bg-surface rounded-2xl shadow-raised p-6 border border-line">
                {offlineMsg ? (
                    <>
                        <h2 id="app-update-title" className="text-lg font-bold text-ink-900">
                            Verificação falhou
                        </h2>
                        <p className="text-sm text-ink-600 mt-2">
                            Não foi possível verificar se há uma atualização. Verifique sua conexão e tente novamente.
                        </p>
                        <button
                            type="button"
                            onClick={() => setVisible(false)}
                            className="mt-5 w-full py-3 rounded-xl bg-ink-900 text-white font-semibold"
                        >
                            OK
                        </button>
                    </>
                ) : upToDate ? (
                    <>
                        <h2 id="app-update-title" className="text-lg font-bold text-ink-900">
                            Você já está atualizado
                        </h2>
                        <p className="text-sm text-ink-600 mt-2">
                            Você já está usando a versão mais recente.
                            {' '}
                            MoveCity Motorista {installed.versionName || '—'}.
                        </p>
                        <button
                            type="button"
                            onClick={() => setVisible(false)}
                            className="mt-5 w-full py-3 rounded-xl bg-ink-900 text-white font-semibold"
                        >
                            OK
                        </button>
                    </>
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 id="app-update-title" className="text-lg font-bold text-ink-900">
                                    {mandatory ? 'Atualização obrigatória' : 'Nova versão disponível'}
                                </h2>
                                <p className="text-sm text-ink-600 mt-1">MoveCity Motorista</p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={downloading}
                                aria-label="Fechar"
                                className="shrink-0 min-w-[44px] min-h-[44px] -mt-1 -mr-1 flex items-center justify-center rounded-xl text-ink-500 hover:bg-surface-alt disabled:opacity-40"
                            >
                                <i className="ri-close-line text-2xl" aria-hidden="true" />
                            </button>
                        </div>

                        {mandatory && (
                            <p className="text-sm text-danger-600 mt-3 bg-danger-50 rounded-xl p-3">
                                Sua versão do MoveCity não é mais compatível. Atualize para continuar utilizando o aplicativo.
                            </p>
                        )}

                        <div className="mt-4 space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span className="text-ink-600">Versão atual</span>
                                <span className="font-medium text-ink-900">{installed.versionName || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-ink-600">Nova versão</span>
                                <span className="font-medium text-ink-900">{remote.version || '—'}</span>
                            </div>
                        </div>

                        {notes.length > 0 && (
                            <div className="mt-4">
                                <p className="text-sm font-semibold text-ink-900 mb-1">Melhorias</p>
                                <ul className="text-sm text-ink-600 list-disc pl-5 space-y-0.5">
                                    {notes.map((n) => (
                                        <li key={n}>{n}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {downloading && (
                            <div className="mt-4">
                                <p className="text-sm text-ink-700 mb-1">Baixando atualização... {percent}%</p>
                                <div className="h-2 rounded-full bg-line overflow-hidden">
                                    <div
                                        className="h-full bg-brand-600 transition-all"
                                        style={{ width: `${Math.min(100, percent)}%` }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    className="mt-2 text-xs text-ink-600 underline"
                                    onClick={() => cancelDownload()}
                                >
                                    Cancelar download
                                </button>
                            </div>
                        )}

                        {error && (
                            <p className="mt-3 text-sm text-danger-600">{error}</p>
                        )}

                        <div className="mt-5 flex flex-col gap-2">
                            <button
                                type="button"
                                disabled={downloading}
                                onClick={onUpdate}
                                className="w-full py-3 rounded-xl bg-brand-600 text-white font-semibold disabled:opacity-60"
                            >
                                {downloading ? 'Baixando...' : 'Atualizar agora'}
                            </button>
                            <button
                                type="button"
                                disabled={downloading}
                                onClick={onClose}
                                className="w-full py-3 rounded-xl bg-surface-alt text-ink-800 font-semibold border border-line disabled:opacity-60"
                            >
                                Fechar
                            </button>
                            {remote.apkUrl && (
                                <button
                                    type="button"
                                    onClick={() => openApkFallback(remote.apkUrl)}
                                    className="w-full py-2 text-sm text-brand-600 font-semibold"
                                >
                                    Não conseguiu atualizar? Baixar APK manualmente
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

/** Dispara verificação forçada (perfil / Sobre). */
export function requestAppUpdateCheck() {
    window.dispatchEvent(new CustomEvent('movecity:check-app-update'))
}
