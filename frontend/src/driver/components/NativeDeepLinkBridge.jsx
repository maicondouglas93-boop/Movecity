import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { bindNativeDeepLinks } from '@/shared/platform/nativeDeepLink.service'

/**
 * Consome deep links nativos em qualquer rota do app motorista.
 * Pós-aceite (accepted): /captain-home → ConfirmRidePopUp; parcel → /captain-parcel.
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
