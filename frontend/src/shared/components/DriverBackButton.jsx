import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { onBackButton } from '@/shared/platform/appLifecycle.service'
import { isNativePlatform } from '@/shared/platform/platform'

const HOME_PATHS = new Set(['/captain-home', '/', '/captain-login'])

/**
 * Botão voltar Android: telas secundárias → history.back;
 * home → minimizar. Nunca cancela corrida.
 */
export default function DriverBackButton() {
    const navigate = useNavigate()
    const location = useLocation()

    useEffect(() => {
        if (!isNativePlatform()) return undefined

        return onBackButton(() => {
            const path = location.pathname
            if (path === '/captain-riding' || path === '/captain-parcel' || path === '/captain-presential') {
                // Corrida/encomenda ativa: volta para home do motorista sem cancelar.
                navigate('/captain-home')
                return true
            }
            if (HOME_PATHS.has(path)) {
                return false // App.minimizeApp via appLifecycle
            }
            if (window.history.length > 1) {
                navigate(-1)
                return true
            }
            navigate('/captain-home')
            return true
        })
    }, [location.pathname, navigate])

    return null
}
