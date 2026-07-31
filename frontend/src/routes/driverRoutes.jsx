import { Route } from 'react-router-dom'

import CaptainLogin from '@/modules/driver/pages/CaptainLogin'
import CaptainSignup from '@/modules/driver/pages/CaptainSignup'
import CaptainLogout from '@/modules/driver/pages/CaptainLogout'
import CaptainProtectWrapper from '@/modules/driver/pages/CaptainProtectWrapper'
import CaptainHome from '@/modules/driver/pages/CaptainHome'
import CaptainRiding from '@/modules/driver/pages/CaptainRiding'
import CaptainWallet from '@/modules/driver/pages/CaptainWallet'
import CaptainRidesHistory from '@/modules/driver/pages/CaptainRidesHistory'
import CaptainEarnings from '@/modules/driver/pages/CaptainEarnings'
import CaptainProfile from '@/modules/driver/pages/CaptainProfile'

// Rotas do fluxo de motorista.
// Mantidas exatamente como estavam em App.jsx: mesmos paths e mesmos wrappers.
// Observacao: '/captain-wallet' e '/captain/wallet' apontam ambas para CaptainWallet,
// duplicidade que ja existia no original e foi preservada.
const driverRoutes = [
  <Route key='captain-login' path='/captain-login' element={<CaptainLogin />} />,
  <Route key='captain-signup' path='/captain-signup' element={<CaptainSignup />} />,

  <Route key='captain-riding' path='/captain-riding' element={
    <CaptainProtectWrapper>
      <CaptainRiding />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-home' path='/captain-home' element={
    <CaptainProtectWrapper>
      <CaptainHome />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-wallet-legacy' path='/captain-wallet' element={
    <CaptainProtectWrapper>
      <CaptainWallet />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-logout' path='/captain/logout' element={
    <CaptainProtectWrapper>
      <CaptainLogout />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-wallet' path='/captain/wallet' element={
    <CaptainProtectWrapper>
      <CaptainWallet />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-rides' path='/captain/rides' element={
    <CaptainProtectWrapper>
      <CaptainRidesHistory />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-earnings' path='/captain/earnings' element={
    <CaptainProtectWrapper>
      <CaptainEarnings />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-profile' path='/captain/profile' element={
    <CaptainProtectWrapper>
      <CaptainProfile />
    </CaptainProtectWrapper>
  } />,
]

export default driverRoutes
