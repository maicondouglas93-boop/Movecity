import { useCallback, useContext } from 'react'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import SessionGuard from '@/shared/components/auth/SessionGuard'

const CaptainProtectWrapper = ({ children }) => {
    const { setCaptain } = useContext(CaptainDataContext)
    const onAuthenticated = useCallback(data => setCaptain(data.captain), [setCaptain])
    return <SessionGuard kind="captain" onAuthenticated={onAuthenticated}>{children}</SessionGuard>
}

export default CaptainProtectWrapper
