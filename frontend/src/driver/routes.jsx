import { lazy } from 'react'
import { Route } from 'react-router-dom'

import CaptainLogin from '@/driver/pages/CaptainLogin'
import CaptainSignup from '@/driver/pages/CaptainSignup'
import CaptainLogout from '@/driver/pages/CaptainLogout'
import CaptainProtectWrapper from '@/driver/pages/CaptainProtectWrapper'
import CaptainHome from '@/driver/pages/CaptainHome'
import CaptainRiding from '@/driver/pages/CaptainRiding'
import CaptainParcelRiding from '@/driver/pages/CaptainParcelRiding'
import CaptainPresentialRide from '@/driver/pages/CaptainPresentialRide'

// Auditoria PWA (2026-08-03, B6): ver comentário equivalente em passengerRoutes.jsx —
// login/cadastro e as duas telas operacionais (Home/Riding) ficam estáticas; carteira,
// histórico, ganhos e perfil são uso ocasional e entram sob demanda.
const CaptainWallet = lazy(() => import('@/driver/pages/CaptainWallet'))
const CaptainRidesHistory = lazy(() => import('@/driver/pages/CaptainRidesHistory'))
const CaptainEarnings = lazy(() => import('@/driver/pages/CaptainEarnings'))
const CaptainProfile = lazy(() => import('@/driver/pages/CaptainProfile'))
const CaptainDocuments = lazy(() => import('@/driver/pages/CaptainDocuments'))
const CaptainScheduled = lazy(() => import('@/driver/pages/CaptainScheduled'))
const CaptainParcels = lazy(() => import('@/driver/pages/CaptainParcels'))
const CaptainNotifications = lazy(() => import('@/driver/pages/CaptainNotifications'))
const CaptainDeleteAccount = lazy(() => import('@/driver/pages/CaptainDeleteAccount'))

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
  <Route key='captain-parcel' path='/captain-parcel' element={
    <CaptainProtectWrapper>
      <CaptainParcelRiding />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-home' path='/captain-home' element={
    <CaptainProtectWrapper>
      <CaptainHome />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-notifications' path='/captain/notifications' element={
    <CaptainProtectWrapper>
      <CaptainNotifications />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-scheduled' path='/captain/scheduled' element={
    <CaptainProtectWrapper>
      <CaptainScheduled />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-presential' path='/captain-presential' element={
    <CaptainProtectWrapper>
      <CaptainPresentialRide />
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
  <Route key='captain-parcels' path='/captain/parcels' element={
    <CaptainProtectWrapper>
      <CaptainParcels />
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
  <Route key='captain-documents' path='/captain/documents' element={
    <CaptainProtectWrapper>
      <CaptainDocuments />
    </CaptainProtectWrapper>
  } />,
  <Route key='captain-delete-account' path='/captain/delete-account' element={
    <CaptainProtectWrapper>
      <CaptainDeleteAccount />
    </CaptainProtectWrapper>
  } />,
]

export default driverRoutes
