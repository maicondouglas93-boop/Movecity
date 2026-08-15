import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'

import SessionSplash from '@/shared/components/ui/SessionSplash'
import driverRoutes from '@/driver/routes'
import legalRoutes from '@/shared/routes/legalRoutes'

// Entrada "/" do bundle motorista — sem Start (CTA de passageiro).
const DriverRootRedirect = () => {
    const navigate = useNavigate()

    useEffect(() => {
        navigate('/captain-home', { replace: true })
    }, [navigate])

    return <SessionSplash label="Carregando..." />
}

const DriverAppRoutes = () => (
    <Suspense fallback={<SessionSplash label="Carregando..." />}>
        <Routes>
            <Route path="/" element={<DriverRootRedirect />} />
            {legalRoutes}
            {driverRoutes}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </Suspense>
)

export default DriverAppRoutes
