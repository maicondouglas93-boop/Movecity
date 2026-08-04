import { Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

import Start from '@/shared/pages/Start'
import SessionSplash from '@/shared/components/ui/SessionSplash'
import passengerRoutes from '@/passenger/routes'
import driverRoutes from '@/driver/routes'

// Ponto unico de composicao das rotas.
// '/' e a tela neutra de escolha entre passageiro e motorista, por isso fica aqui
// e nao dentro de um modulo.
// Auditoria PWA (2026-08-03, B6): Suspense pega a espera de QUALQUER rota lazy
// (passengerRoutes/driverRoutes) — as rotas estáticas (Home, Riding, login) nunca
// suspendem, então nunca mostram este fallback.
const AppRoutes = () => (
  <Suspense fallback={<SessionSplash label="Carregando..." />}>
    <Routes>
      <Route path='/' element={<Start />} />
      {passengerRoutes}
      {driverRoutes}
    </Routes>
  </Suspense>
)

export default AppRoutes
