import { useContext } from 'react'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import SessionGuard from '@/shared/components/auth/SessionGuard'

const UserProtectWrapper = ({ children }) => {
    const { setUser } = useContext(UserDataContext)
    return <SessionGuard kind="user" onAuthenticated={setUser}>{children}</SessionGuard>
}

export default UserProtectWrapper
