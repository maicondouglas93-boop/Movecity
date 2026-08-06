import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { bindNativeDeepLinks } from '@/shared/platform/nativeDeepLink.service'

/**
 * Consome deep links nativos em qualquer rota do app motorista
 * (pós-aceite → /captain-riding ou /captain-parcel, não só na Home).
 */
export default function NativeDeepLinkBridge() {
    const navigate = useNavigate()

    useEffect(() => {
        let cleanup
        ;(async () => {
            cleanup = await bindNativeDeepLinks(navigate)
        })()
        return () => cleanup?.()
    }, [navigate])

    return null
}
