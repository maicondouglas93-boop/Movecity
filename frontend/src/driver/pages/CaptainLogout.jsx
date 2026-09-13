import { useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAccessToken, getRefreshToken } from '@/shared/services/session'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { logoutCaptain } from '@/driver/services/logoutCaptain'
import { SocketContext } from '@/shared/contexts/SocketContext'
import SessionSplash from '@/shared/components/ui/SessionSplash'

export const CaptainLogout = () => {
    const navigate = useNavigate()
    const { socket } = useContext(SocketContext)
    const { setCaptain } = useContext(CaptainDataContext)
    const work = useRef(null)

    useEffect(() => {
        let active = true
        if (!work.current) {
            work.current = logoutCaptain()
            setCaptain(null)
            socket?.disconnect()
        }
        work.current.then(() => {
            // StrictMode não duplica a saída. Uma operação antiga não redireciona
            // nem apaga um login que ocorreu depois da limpeza local.
            if (!active || getAccessToken('captain') || getRefreshToken('captain')) return
            socket?.connect()
            navigate('/captain-login', { replace: true })
        })
        return () => { active = false }
    }, [navigate, socket, setCaptain])

    return <SessionSplash label="Saindo..." />
}

export default CaptainLogout
