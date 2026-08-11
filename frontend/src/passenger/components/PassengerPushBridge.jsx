import { useContext, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { useToast } from '@/shared/contexts/ToastContext'
import { bindPushNavigation, registerPush } from '@/shared/platform/notification.service'
import { isNativePlatform } from '@/shared/platform/platform'
import { normalizePassengerDeepLink } from '@/passenger/platform/passengerDeepLink.service'

/** Inicialização única do push Android, fora das telas e protegida por plataforma. */
export default function PassengerPushBridge() {
    const { user } = useContext(UserDataContext)
    const { addToast } = useToast()
    const navigate = useNavigate()

    useEffect(() => {
        if (!isNativePlatform() || !user?._id) return undefined

        let cleanup
        let disposed = false

        ;(async () => {
            // Sequencial: evita a corrida de removeAllListeners já identificada na
            // auditoria do Motorista sem alterar o comportamento dele.
            await registerPush()
            if (disposed) return

            const nextCleanup = await bindPushNavigation(({ data, deepLink, fromTap }) => {
                if (fromTap) {
                    const target = normalizePassengerDeepLink(deepLink)
                    if (target) navigate(target)
                    return
                }

                const title = data?.title
                const body = data?.message || data?.body
                if (title || body) {
                    addToast([title, body].filter(Boolean).join(' — '), 'info')
                }
            })

            if (disposed) nextCleanup?.()
            else cleanup = nextCleanup
        })()

        return () => {
            disposed = true
            cleanup?.()
        }
    }, [addToast, navigate, user?._id])

    return null
}
