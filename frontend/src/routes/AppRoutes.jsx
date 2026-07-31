import { Route, Routes } from 'react-router-dom'

import Start from '@/shared/pages/Start'
import passengerRoutes from '@/routes/passengerRoutes'
import driverRoutes from '@/routes/driverRoutes'

// Ponto unico de composicao das rotas.
// '/' e a tela neutra de escolha entre passageiro e motorista, por isso fica aqui
// e nao dentro de um modulo.
const AppRoutes = () => (
  <Routes>
    <Route path='/' element={<Start />} />
    {passengerRoutes}
    {driverRoutes}
  </Routes>
)

export default AppRoutes
