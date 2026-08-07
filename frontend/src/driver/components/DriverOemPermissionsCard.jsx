import { useEffect, useState } from 'react'
import { isNativePlatform } from '@/shared/platform/platform'
import {
    getDriverPermissionStatus,
    markOemPermissionsOnboardingSeen,
    openBatteryOptimizationSettings,
    openDriverAppSettings,
    openFullScreenIntentSettings,
    openNotificationPolicySettings,
    openOemAutostartSettings,
    openOemOtherPermissions,
    requestBackgroundLocationPermission,
    shouldShowOemPermissionsCard,
} from '@/shared/platform/driverPermissions.service'

/**
 * Onboarding único (dispensável) para permissões que o Android/MIUI
 * não concedem só pelo request padrão — críticas para oferta full-screen.
 * Não bloqueia GO nem ONLINE.
 */
export default function DriverOemPermissionsCard() {
    const [visible, setVisible] = useState(false)
    const [status, setStatus] = useState(null)

    const refresh = async () => {
        if (!isNativePlatform()) return
        const show = await shouldShowOemPermissionsCard()
        if (!show) {
            setVisible(false)
            return
        }
        const next = await getDriverPermissionStatus()
        setStatus(next)
        setVisible(true)
    }

    useEffect(() => {
        refresh()
        const onVis = () => {
            if (document.visibilityState === 'visible') refresh()
        }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [])

    if (!visible || !status) return null

    const dismiss = () => {
        markOemPermissionsOnboardingSeen()
        setVisible(false)
    }

    return (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-50 text-ink-900 px-4 py-3.5 shadow-raised">
            <div className="flex items-start gap-2">
                <i className="ri-shield-keyhole-line text-xl text-amber-700 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[15px] text-ink-900">
                        Para receber ofertas com o app fechado
                    </h3>
                    <p className="text-[12px] text-ink-700 mt-1 leading-snug">
                        No Android (especialmente Xiaomi/Redmi) é preciso liberar algumas
                        permissões nas configurações do sistema. Isso não altera ONLINE nem o botão GO.
                    </p>

                    <ul className="mt-3 space-y-2">
                        {!status.canUseFullScreenIntent && (
                            <li>
                                <ActionRow
                                    label="Permitir tela cheia (ofertas)"
                                    hint="Android 14+ — necessário para abrir a oferta sobre a tela de bloqueio"
                                    onClick={openFullScreenIntentSettings}
                                />
                            </li>
                        )}
                        {!status.ignoringBatteryOptimizations && (
                            <li>
                                <ActionRow
                                    label="Ignorar otimização de bateria"
                                    hint="Evita o sistema matar o GPS e o push em segundo plano"
                                    onClick={openBatteryOptimizationSettings}
                                />
                            </li>
                        )}
                        {status.hasNotificationPolicyAccess === false && (
                            <li>
                                <ActionRow
                                    label="Permitir em Não Perturbe"
                                    hint="Sem isso, a oferta não toca nem vibra com o celular em silêncio/foco"
                                    onClick={openNotificationPolicySettings}
                                />
                            </li>
                        )}
                        {status.hasBackgroundLocation === false && (
                            <li>
                                <ActionRow
                                    label="Localização o tempo todo"
                                    hint="Necessário para GPS com app minimizado / tela bloqueada"
                                    onClick={async () => {
                                        const r = await requestBackgroundLocationPermission()
                                        if (!r.granted) await openDriverAppSettings()
                                        await refresh()
                                    }}
                                />
                            </li>
                        )}
                        {status.isXiaomiFamily && (
                            <>
                                <li>
                                    <ActionRow
                                        label="Autostart (Xiaomi)"
                                        hint="Permite o app acordar para nova corrida/encomenda"
                                        onClick={openOemAutostartSettings}
                                    />
                                </li>
                                <li>
                                    <ActionRow
                                        label="Janelas pop-up / tela bloqueada"
                                        hint="Em Outras permissões do Security Center"
                                        onClick={openOemOtherPermissions}
                                    />
                                </li>
                            </>
                        )}
                        <li>
                            <ActionRow
                                label="Abrir informações do app"
                                hint="Localização “o tempo todo”, notificações e detalhes"
                                onClick={openDriverAppSettings}
                            />
                        </li>
                    </ul>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={async () => {
                                const next = await getDriverPermissionStatus()
                                setStatus(next)
                                // Autostart/pop-up MIUI não são consultáveis — fecha se o resto ok.
                                const bgOk = next.hasBackgroundLocation !== false
                                const dndOk = next.hasNotificationPolicyAccess !== false
                                if (
                                    next.canUseFullScreenIntent
                                    && next.ignoringBatteryOptimizations
                                    && dndOk
                                    && bgOk
                                ) {
                                    markOemPermissionsOnboardingSeen()
                                    setVisible(false)
                                }
                            }}
                            className="px-3 py-2 rounded-full bg-[#0B3D2E] text-white text-xs font-bold active:scale-95"
                        >
                            Já configurei — verificar
                        </button>
                        <button
                            type="button"
                            onClick={dismiss}
                            className="px-3 py-2 rounded-full bg-white border border-ink-200 text-ink-800 text-xs font-bold active:scale-95"
                        >
                            Agora não
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function ActionRow({ label, hint, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full text-left rounded-xl bg-white border border-amber-500/20 px-3 py-2.5 active:scale-[0.99] transition"
        >
            <span className="flex items-center justify-between gap-2">
                <span className="font-bold text-[13px] text-ink-900">{label}</span>
                <i className="ri-arrow-right-up-line text-amber-700" aria-hidden="true" />
            </span>
            {hint && (
                <span className="block text-[11px] text-ink-600 mt-0.5 leading-snug">{hint}</span>
            )}
        </button>
    )
}
