/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from 'react'
import DriverOemPermissionsCard from '@/driver/components/DriverOemPermissionsCard'
import { onAppActive } from '@/shared/platform/appLifecycle.service'
import { getPushPermissionStatus, registerPush } from '@/shared/platform/notification.service'
import { openDriverAppSettings } from '@/shared/platform/driverPermissions.service'
import { isNativePlatform } from '@/shared/platform/platform'
import { getAccessToken } from '@/shared/services/session'
import { syncTokenWithSW } from '@/shared/services/swCommunication'

const SNOOZE_KEY = 'driverPermissionNoticeSnooze_v2'
const SNOOZE_MS = 24 * 60 * 60 * 1000

function readSnooze() {
    try {
        const value = JSON.parse(localStorage.getItem(SNOOZE_KEY) || 'null')
        if (!value?.issue || !Number.isFinite(value?.until)) return null
        if (value.until <= Date.now()) {
            localStorage.removeItem(SNOOZE_KEY)
            return null
        }
        return value
    } catch {
        return null
    }
}

function saveSnooze(issue) {
    try {
        localStorage.setItem(SNOOZE_KEY, JSON.stringify({
            issue,
            until: Date.now() + SNOOZE_MS,
        }))
    } catch {
        /* ignore */
    }
}

function clearSnooze() {
    try {
        localStorage.removeItem(SNOOZE_KEY)
    } catch {
        /* ignore */
    }
}

/**
 * Fluxo único de permissões da Home do motorista.
 *
 * Ordem:
 * 1. permissão básica de notificação;
 * 2. registro do token (não confundir com permissão negada);
 * 3. ajustes avançados de localização/bateria/OEM.
 *
 * Só um aviso é exibido por vez. Ao voltar das configurações o estado real do
 * Android é consultado novamente, sem exigir fechar/reabrir o aplicativo.
 */
export default function DriverPermissionsPanel() {
    const [phase, setPhase] = useState('checking')
    const [busy, setBusy] = useState(false)
    const [, setSnoozeRevision] = useState(0)

    const refresh = useCallback(async ({ requestPermission = false } = {}) => {
        setBusy(true)
        try {
            let permission = await getPushPermissionStatus()
            if (!permission.supported) {
                setPhase('unsupported')
                return
            }

            if (permission.state === 'denied') {
                setPhase('denied')
                return
            }

            if (!permission.granted && !requestPermission) {
                setPhase(permission.state === 'error' ? 'check_failed' : 'prompt')
                return
            }

            const token = await registerPush({ requestPermission })
            permission = await getPushPermissionStatus()

            if (token) {
                if (!isNativePlatform()) {
                    const jwt = getAccessToken('captain')
                    if (jwt) await syncTokenWithSW(jwt)
                }
                clearSnooze()
                setPhase('ready')
            } else if (permission.state === 'denied') {
                setPhase('denied')
            } else if (!permission.granted) {
                setPhase(permission.state === 'error' ? 'check_failed' : 'prompt')
            } else {
                setPhase('registration_failed')
            }
        } catch (err) {
            console.warn('[DriverPermissions] push refresh:', err?.message || err)
            setPhase('check_failed')
        } finally {
            setBusy(false)
        }
    }, [])

    useEffect(() => {
        let active = true
        refresh().catch(() => {
            if (active) setPhase('check_failed')
        })
        const offActive = onAppActive(() => refresh())
        return () => {
            active = false
            offActive?.()
        }
    }, [refresh])

    const dismiss = () => {
        saveSnooze(phase)
        setSnoozeRevision((value) => value + 1)
    }

    const snooze = readSnooze()
    const isSnoozed = snooze?.issue === phase

    if (phase === 'checking' || phase === 'unsupported') return null
    if (phase === 'ready') return <DriverOemPermissionsCard />
    if (isSnoozed) return null

    if (phase === 'prompt') {
        return (
            <PermissionNotice
                icon="ri-notification-3-fill"
                title="Ativar notificações de corrida?"
                description="Elas avisam sobre novas corridas e encomendas quando o app estiver minimizado ou a tela estiver bloqueada."
                primaryLabel={busy ? 'Ativando…' : 'Ativar'}
                onPrimary={() => refresh({ requestPermission: true })}
                onDismiss={dismiss}
                busy={busy}
            />
        )
    }

    if (phase === 'denied') {
        const native = isNativePlatform()
        return (
            <PermissionNotice
                icon="ri-notification-off-fill"
                title="Notificações estão bloqueadas"
                description={native
                    ? 'Abra as configurações do app, permita notificações e volte. O aviso será atualizado automaticamente.'
                    : 'Permita notificações nas configurações deste site no navegador e depois verifique novamente.'}
                primaryLabel={native ? 'Abrir configurações' : 'Verificar novamente'}
                onPrimary={native ? openDriverAppSettings : () => refresh()}
                onDismiss={dismiss}
                busy={busy}
            />
        )
    }

    if (phase === 'registration_failed') {
        return (
            <PermissionNotice
                icon="ri-refresh-line"
                title="Notificações permitidas; sincronização pendente"
                description="A permissão já está correta, mas o aparelho ainda não concluiu o registro para receber ofertas. Verifique a internet e tente novamente."
                primaryLabel={busy ? 'Sincronizando…' : 'Tentar novamente'}
                onPrimary={() => refresh({ requestPermission: false })}
                onDismiss={dismiss}
                busy={busy}
            />
        )
    }

    return (
        <PermissionNotice
            icon="ri-error-warning-line"
            title="Não foi possível verificar as notificações"
            description="O Android não respondeu à verificação. Tente novamente; seu status online não será alterado."
            primaryLabel={busy ? 'Verificando…' : 'Verificar novamente'}
            onPrimary={() => refresh()}
            onDismiss={dismiss}
            busy={busy}
        />
    )
}

function PermissionNotice({
    icon,
    title,
    description,
    primaryLabel,
    onPrimary,
    onDismiss,
    busy,
}) {
    return (
        <div
            className="rounded-2xl border border-amber-500/30 bg-amber-50 text-ink-900 px-4 py-3.5 shadow-raised"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-start gap-2.5">
                <i className={`${icon} text-xl text-amber-700 mt-0.5`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[15px] text-ink-900">{title}</h3>
                    <p className="text-[12px] text-ink-700 mt-1 leading-snug">{description}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={onPrimary}
                            disabled={busy}
                            className="px-3 py-2 rounded-full bg-brand-500 text-white text-xs font-bold active:scale-95 disabled:opacity-60"
                        >
                            {primaryLabel}
                        </button>
                        <button
                            type="button"
                            onClick={onDismiss}
                            disabled={busy}
                            className="px-3 py-2 rounded-full bg-white border border-ink-200 text-ink-800 text-xs font-bold active:scale-95 disabled:opacity-60"
                        >
                            Agora não
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
