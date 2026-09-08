import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'
import DriverOperationalDialog from '@/driver/components/DriverOperationalDialog'
import { onAppActive } from '@/shared/platform/appLifecycle.service'
import {
    checkForUpdate,
    dismissOptionalUpdate,
    downloadAndInstall,
    openApkFallback,
    resumeInstall,
    cancelDownload,
    getDriverUpdateChannel,
} from '@/shared/platform/appUpdate.service'

const PLAY_URL = 'https://play.google.com/store/apps/details?id=br.com.movecity.driver'

/** Entrada única: Play, APK externo ou navegador. Nunca recarrega a sessão. */
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
    const installRef = useRef(false)
    const { captain } = useContext(CaptainDataContext) || {}
    const { captainRide, captainParcel, captainRideReconciled } = useContext(RideContext) || {}
    const { pathname } = useLocation()
    const { addToast } = useToast()
    const channel = getDriverUpdateChannel()
    // Não abre instalador/loja durante atendimento, recebimento de ofertas ou restauração.
    const blocked = Boolean(captainRide || captainParcel || captain?.isOnline
        || (captain?._id && !captainRideReconciled)
        || /captain-(riding|parcel)/.test(pathname))
    const blockedRef = useRef(blocked)
    blockedRef.current = blocked
    const mountedRef = useRef(false)
    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
    }, [])
    // Retorno da tela de permissão não deve perder o APK já baixado.
    useEffect(() => { setLocalPath('') }, [state?.remote?.versionCode])

    const runCheck = useCallback(async ({ force = false } = {}) => {
        if (blockedRef.current) {
            if (force) addToast('Conclua o atendimento e fique offline antes de atualizar. Se acabou de entrar, aguarde a recuperação da sessão.', 'info')
            return
        }
        if (busyRef.current || installRef.current) return
        if (channel !== 'sideload') {
            if (force) { setState({ channel }); setVisible(true) }
            return
        }
        busyRef.current = true
        if (force) addToast('Verificando atualização...', 'info')
        try {
            const result = await checkForUpdate({ force })
            if (!mountedRef.current) return
            setError('')
            if (result.available === true) {
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
                if (!result.ok) {
                    setState({
                        ...result,
                        manualOffline: true,
                        installed: result.installed,
                        remote: result.remote || {},
                    })
                    setVisible(true)
                    return
                }
                if (result.ok) {
                    setState({ ...result, manualUpToDate: true, noRelease: result.reason !== 'up-to-date' })
                    setVisible(true)
                }
            }
        } catch {
            if (mountedRef.current && force) {
                setState({ manualOffline: true })
                setVisible(true)
            }
        } finally {
            busyRef.current = false
        }
    }, [channel, addToast])

    useEffect(() => {
        const onManual = () => runCheck({ force: true })
        window.addEventListener('movecity:check-app-update', onManual)
        return () => window.removeEventListener('movecity:check-app-update', onManual)
    }, [runCheck])

    useEffect(() => {
        if (channel !== 'sideload' || blocked) return undefined
        const t = setTimeout(() => {
            runCheck({ force: false })
        }, 800)
        const off = onAppActive(() => {
            runCheck({ force: false })
        })
        return () => {
            clearTimeout(t)
            off?.()
        }
    }, [runCheck, channel, blocked])

    if (blocked || !visible || !state) return null

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
        if (blockedRef.current || installRef.current) return
        installRef.current = true
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
            installRef.current = false
            setDownloading(false)
        }
    }

    const notes = Array.isArray(remote.releaseNotes) ? remote.releaseNotes : []

    return (
        <DriverOperationalDialog title="Atualização do aplicativo" onClose={onClose} busy={downloading} closeLabel="Fechar atualização">
            <div className="text-ink-900">
                {state.channel ? (
                    <>
                        <p className="text-sm text-ink-600 mt-2">
                            {state.channel === 'play'
                                ? 'Esta versão é atualizada pela Google Play. Abra a loja para conferir se há uma atualização disponível para seu aparelho.'
                                : 'Você está usando a versão no navegador. Não há verificação automática de novas versões neste acesso. Depois do atendimento, feche e abra o site novamente para carregar a versão publicada.'}
                        </p>
                        {state.channel === 'play' && <a href={PLAY_URL} target="_blank" rel="noopener noreferrer"
                            onClick={event => { if (blockedRef.current) event.preventDefault() }}
                            className="mt-4 block rounded-xl bg-brand-700 text-white text-center p-3 font-semibold">Abrir Google Play</a>}
                        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl border border-line p-3">Fechar</button>
                    </>
                ) : offlineMsg ? (
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
                            {state.noRelease ? 'Nenhuma atualização publicada neste canal' : 'Você já está atualizado'}
                        </h2>
                        <p className="text-sm text-ink-600 mt-2">
                            {state.noRelease ? 'Não foi encontrada uma versão disponível para instalação por este canal.' : 'Você já está usando a versão mais recente deste canal.'}
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
                                    disabled={downloading}
                                    onClick={() => { if (!blockedRef.current) openApkFallback(remote.apkUrl) }}
                                    className="w-full py-2 text-sm text-brand-600 font-semibold"
                                >
                                    Não conseguiu atualizar? Baixar APK manualmente
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </DriverOperationalDialog>
    )
}

/** Dispara verificação forçada (perfil / Sobre). */
export function requestAppUpdateCheck() {
    window.dispatchEvent(new CustomEvent('movecity:check-app-update'))
}
