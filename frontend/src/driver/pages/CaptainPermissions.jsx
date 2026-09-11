import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/shared/components/ui/PageHeader'
import { isNativePlatform } from '@/shared/platform/platform'
import { onAppActive } from '@/shared/platform/appLifecycle.service'
import { getDriverPermissionStatus, openDriverPermissionSettings, requestBackgroundLocationPermission } from '@/shared/platform/driverPermissions.service'
import { getPushPermissionStatus, registerPush } from '@/shared/platform/notification.service'
import { requestLocationPermission } from '@/shared/platform/location.service'

const BUTTON = 'min-h-[48px] w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 active:scale-[0.99]'

export default function CaptainPermissions() {
    const navigate = useNavigate()
    const native = isNativePlatform()
    const [status, setStatus] = useState({})
    const [push, setPush] = useState(null)
    const [checking, setChecking] = useState(native)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [readError, setReadError] = useState('')
    const [notice, setNotice] = useState('')
    const mounted = useRef(false)
    const sequence = useRef(0)
    const actionLock = useRef(false)

    const refresh = useCallback(async () => {
        if (!native) return
        const request = ++sequence.current
        setChecking(true)
        try {
            const [next, permission] = await Promise.all([
                getDriverPermissionStatus({ strict: true }), getPushPermissionStatus(),
            ])
            if (!mounted.current || request !== sequence.current) return
            setStatus(next)
            setPush(permission)
            setReadError('')
        } catch {
            if (!mounted.current || request !== sequence.current) return
            setStatus({})
            setPush(null)
            setReadError('Não foi possível conferir as permissões. Tente verificar novamente. Nenhuma autorização foi alterada.')
        } finally {
            if (mounted.current && request === sequence.current) setChecking(false)
        }
    }, [native])

    useEffect(() => {
        mounted.current = true
        refresh()
        const off = native ? onAppActive(refresh) : null
        return () => { mounted.current = false; off?.() }
    }, [native, refresh])

    const run = async action => {
        if (actionLock.current) return
        actionLock.current = true
        setBusy(true)
        setError('')
        setNotice('')
        try {
            const result = await action()
            if (mounted.current && result?.oemSpecific === false) {
                setNotice('O fabricante não disponibilizou o atalho direto. Nas informações do app, procure Outras permissões ou Inicialização automática.')
            }
        } catch {
            if (mounted.current) setError('Não foi possível abrir ou solicitar essa autorização. Tente novamente ou use “Abrir configurações do aplicativo”.')
        } finally {
            if (mounted.current) await refresh()
            actionLock.current = false
            if (mounted.current) setBusy(false)
        }
    }
    const settings = key => () => openDriverPermissionSettings(key)
    const allowLocation = async () => {
        const result = await requestLocationPermission()
        if (result.state === 'error') throw new Error('Location unavailable')
        if (!result.granted) return openDriverPermissionSettings('app')
    }
    const allowBackground = async () => {
        // Pedidos separados: primeiro localização durante o uso. Android 11+
        // exige escolher "Permitir o tempo todo" nas configurações do aplicativo.
        if (status.hasBackgroundLocation === true) return openDriverPermissionSettings('app')
        if (status.hasForegroundLocation !== true) {
            await allowLocation()
            if (mounted.current) setNotice('Após permitir a localização durante o uso, toque novamente em “Localização o tempo todo”.')
            return
        }
        if (status.sdkInt >= 30) return openDriverPermissionSettings('app')
        const result = await requestBackgroundLocationPermission()
        if (result.state === 'error') throw new Error('Background location unavailable')
        if (!result.granted) return openDriverPermissionSettings('app')
    }
    const allowNotifications = async () => {
        if (push?.state !== 'prompt' && push?.state !== 'prompt-with-rationale') return openDriverPermissionSettings('notifications')
        const token = await registerPush({ requestPermission: true })
        const permission = await getPushPermissionStatus()
        if (permission.granted && !token && mounted.current) {
            setNotice('Notificações permitidas. O registro para receber ofertas ainda precisa de conexão com o servidor; isso não significa permissão negada.')
        }
    }

    const rows = [
        { id: 'overlay', title: 'Tela de oferta sobre outros apps', value: status.canDrawOverlays,
            description: 'Para mostrar a tela verde de Aceitar e Recusar com o MoveCity minimizado. No Android, escolha MoveCity Motorista e ative “Aparecer sobre outros apps”. Sem essa autorização, fica apenas a notificação.',
            label: 'Autorizar aparecer sobre outros apps', action: settings('overlay'), primary: true },
        { id: 'notifications', title: 'Notificações de corridas', value: status.notificationsEnabled,
            description: 'Permite os avisos de novas corridas e encomendas. Nas configurações, habilite as notificações do MoveCity Motorista.',
            label: 'Autorizar notificações', action: allowNotifications },
        ...(status.sdkInt >= 26 ? [{ id: 'offers', title: 'Som e destaque das ofertas', value: status.offerAlertsConfigured,
            description: 'No canal “Ofertas urgentes”, permita os alertas, escolha um som e confira o destaque na tela. O volume e o modo Não Perturbe também influenciam o toque.',
            label: 'Configurar som e alertas', action: settings('offers') }] : []),
        { id: 'location', title: 'Localização durante o uso', value: status.hasForegroundLocation,
            description: 'Usada para encontrar serviços próximos e acompanhar o percurso. Permita a localização precisa quando o Android perguntar.',
            label: 'Autorizar localização', action: status.hasForegroundLocation === true ? settings('app') : allowLocation },
        { id: 'background', title: 'Localização o tempo todo', value: status.hasBackgroundLocation,
            description: 'O MoveCity coleta sua localização em segundo plano enquanto você está online ou em uma corrida, mesmo com o app minimizado ou a tela bloqueada, para acompanhar o percurso e atualizar sua posição. Em Permissões → Localização, escolha “Permitir o tempo todo”. Você pode manter isso desativado.',
            label: 'Localização o tempo todo', action: allowBackground },
        { id: 'battery', title: 'Funcionamento em segundo plano', value: status.ignoringBatteryOptimizations,
            description: 'Opcional: permite reduzir as restrições de bateria sobre o MoveCity enquanto você trabalha. Pode aumentar o consumo de bateria.',
            label: 'Configurar bateria', action: settings('battery') },
        ...(status.supportsFullScreenIntent === true ? [{ id: 'fullScreen', title: 'Ofertas em tela cheia', value: status.canUseFullScreenIntent,
            description: 'Disponível nesta distribuição do app. Permite ao Android apresentar ofertas em tela cheia, conforme as regras do aparelho.',
            label: 'Configurar tela cheia', action: settings('fullScreen') }] : []),
        ...(status.isXiaomiFamily ? [
            { id: 'oem', title: 'Janelas em segundo plano — Xiaomi / Redmi / POCO',
                description: 'Em Outras permissões, confira “Abrir novas janelas enquanto executa em segundo plano”, “Exibir janelas pop-up” e “Mostrar na tela de bloqueio”. Essa autorização pode ser separada da sobreposição.',
                label: 'Autorizar janelas em segundo plano', action: settings('oem'), manual: true },
            { id: 'autostart', title: 'Inicialização automática', description: 'Confira se o fabricante permite que o MoveCity receba ofertas em segundo plano. O app não consegue verificar essa opção automaticamente.',
                label: 'Configurar início automático', action: settings('autostart'), manual: true },
        ] : []),
        { id: 'dnd', title: 'Não Perturbe — opcional', value: status.hasNotificationPolicyAccess,
            description: 'Autorize somente se quiser permitir alertas durante o modo Não Perturbe. Não é necessário para abrir a tela verde e não substitui o volume do aparelho.',
            label: 'Configurar Não Perturbe', action: settings('dnd') },
    ]

    return <div className="h-full min-h-0 flex flex-col bg-surface-alt">
        <PageHeader title="Permissões do aplicativo" onBack={() => navigate('/captain-home')} />
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-xl space-y-4">
                {!native ? <p className="rounded-xl bg-surface p-4 text-ink-700">Esses botões estão disponíveis no aplicativo Android MoveCity Motorista. No navegador, as permissões são gerenciadas nas configurações do site.</p> : <>
                    <p className="text-sm text-ink-700">Toque no botão de cada autorização e confirme no Android. Ao voltar, conferimos o estado novamente. Esta área fica sempre disponível no menu e não altera seu status online.</p>
                    {readError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-ink-900">{readError}</p>}
                    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-ink-900">{error}</p>}
                    {notice && <p role="status" className="rounded-xl bg-brand-50 p-3 text-ink-900">{notice}</p>}
                    <p role="status" className="text-sm text-ink-600">{checking ? 'Conferindo autorizações…' : 'Confira abaixo o estado informado pelo Android.'}</p>
                    {rows.map(row => <section key={row.id} aria-labelledby={`permission-${row.id}`}
                        className={`rounded-2xl border p-4 shadow-raised ${row.primary ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface'}`}>
                        <h3 id={`permission-${row.id}`} className="font-bold text-ink-900">{row.title}</h3>
                        <p className={`mt-1 text-sm font-semibold ${!checking && row.value === true ? 'text-brand-700' : 'text-ink-600'}`}>
                            {checking ? 'Conferindo…' : row.manual ? 'Conferir no Android' : row.value === true ? 'Ativado' : row.value === false ? 'Não ativado' : 'Não foi possível conferir'}
                        </p>
                        <p className="my-3 text-sm leading-relaxed text-ink-700">{row.description}</p>
                        <button type="button" disabled={busy || checking} onClick={() => run(row.action)} className={BUTTON}>
                            {row.value === true ? `Revisar: ${row.title}` : row.label}
                        </button>
                    </section>)}
                    <button type="button" disabled={busy || checking} onClick={() => refresh()} className={BUTTON}>Verificar autorizações novamente</button>
                    <button type="button" disabled={busy} onClick={() => run(settings('app'))} className="min-h-[48px] w-full rounded-xl border border-line bg-surface p-3 font-semibold text-ink-900 disabled:opacity-50">Abrir configurações do aplicativo</button>
                    <p className="text-xs leading-relaxed text-ink-600">Permissões ativadas não garantem a entrega de uma oferta. Depois de configurar, teste uma nova oferta com o app minimizado. Ajustes do fabricante podem exigir uma confirmação adicional.</p>
                </>}
            </div>
        </main>
    </div>
}
