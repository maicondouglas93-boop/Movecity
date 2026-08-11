import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { bindPassengerNativeDeepLinks } from '@/passenger/platform/passengerDeepLink.service'

export default function PassengerNativeDeepLinkBridge() {
    const navigate = useNavigate()

    useEffect(() => {
        let cleanup
        let disposed = false

        ;(async () => {
            const nextCleanup = await bindPassengerNativeDeepLinks(navigate)
            if (disposed) nextCleanup?.()
            else cleanup = nextCleanup
        })()

        return () => {
            disposed = true
            cleanup?.()
        }
    }, [navigate])

    return null
}
