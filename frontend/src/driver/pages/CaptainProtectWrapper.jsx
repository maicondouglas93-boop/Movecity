import { useCallback, useContext } from 'react'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import SessionGuard from '@/shared/components/auth/SessionGuard'
import { getSessionOwnerId } from '@/shared/services/session'
import { loadDriverRecovery, readDriverRecovery, saveDriverProfile, clearDriverRecovery } from '@/shared/services/driverRecoveryStore'

async function readOfflineRecovery() {
    const saved = await loadDriverRecovery(getSessionOwnerId('captain'))
    return saved ? { captain: saved.profile, ride: saved.ride } : null
}

function canResumeOffline(recovery) {
    const saved = readDriverRecovery(getSessionOwnerId('captain'))
    return saved?.ride?.status === 'started' && saved.ride._id === recovery?.ride?._id
}

const CaptainProtectWrapper = ({ children }) => {
    const { setCaptain } = useContext(CaptainDataContext)
    const onAuthenticated = useCallback(data => {
        saveDriverProfile(getSessionOwnerId('captain'), data.captain)
        setCaptain(data.captain)
    }, [setCaptain])
    return <SessionGuard kind="captain" onAuthenticated={onAuthenticated}
        readOfflineRecovery={readOfflineRecovery} offlineRoute="/captain-riding"
        canResumeOffline={canResumeOffline} onRecoveryRejected={clearDriverRecovery}>{children}</SessionGuard>
}

export default CaptainProtectWrapper
