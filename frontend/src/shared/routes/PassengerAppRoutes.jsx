import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'

import SessionSplash from '@/shared/components/ui/SessionSplash'
import passengerRoutes from '@/passenger/routes'
import legalRoutes from '@/shared/routes/legalRoutes'

const PassengerRootRedirect = () => {
    const navigate = useNavigate()

    useEffect(() => {
        // Cookie HttpOnly não pode ser inspecionado aqui; a rota protegida valida a
        // sessão no servidor e redireciona se a renovação falhar.
        navigate('/home', { replace: true })
    }, [navigate])

    return <SessionSplash label="Carregando..." />
}

const PassengerAppRoutes = () => (
    <Suspense fallback={<SessionSplash label="Carregando..." />}>
        <Routes>
            <Route path="/" element={<PassengerRootRedirect />} />
            {legalRoutes}
            {passengerRoutes}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </Suspense>
)

export default PassengerAppRoutes
