import { lazy } from 'react'
import { Route } from 'react-router-dom'

import UserLogin from '@/passenger/pages/UserLogin'
import UserSignup from '@/passenger/pages/UserSignup'
import UserLogout from '@/passenger/pages/UserLogout'
import UserProtectWrapper from '@/passenger/pages/UserProtectWrapper'
import Home from '@/passenger/pages/Home'
import Riding from '@/passenger/pages/Riding'
import ParcelWizard from '@/passenger/pages/parcel/ParcelWizard'
import ParcelActive from '@/passenger/pages/parcel/ParcelActive'
import ScheduleHub from '@/passenger/pages/ScheduleHub'
import ScheduleRide from '@/passenger/pages/ScheduleRide'

// Auditoria PWA (2026-08-03, B6): login/cadastro, Home e Riding ficam estáticos —
// são o caminho mais comum de toda sessão, carregar sob demanda só adicionaria uma
// viagem de rede extra bem na hora mais sensível. As telas de conta (uso ocasional,
// nenhuma delas faz parte do fluxo de pedir/fazer uma corrida) entram sob demanda —
// hoje elas iam todas no mesmo bundle inicial de ~1,17MB mesmo sem ninguém abrir
// "Ajuda" ou "Termos" naquela sessão.
const Activity = lazy(() => import('@/passenger/pages/Activity'))
const Account = lazy(() => import('@/passenger/pages/account/Account'))
const Wallet = lazy(() => import('@/passenger/pages/account/Wallet'))
const Coupons = lazy(() => import('@/passenger/pages/account/Coupons'))
const Profile = lazy(() => import('@/passenger/pages/account/Profile'))
const PersonalData = lazy(() => import('@/passenger/pages/account/PersonalData'))
const ChangePassword = lazy(() => import('@/passenger/pages/account/ChangePassword'))
const DeleteAccount = lazy(() => import('@/passenger/pages/account/DeleteAccount'))
const Terms = lazy(() => import('@/passenger/pages/account/Terms'))
const Privacy = lazy(() => import('@/passenger/pages/account/Privacy'))
const Cards = lazy(() => import('@/passenger/pages/account/Cards'))
const Scheduled = lazy(() => import('@/passenger/pages/account/Scheduled'))
const Favorites = lazy(() => import('@/passenger/pages/account/Favorites'))
const Help = lazy(() => import('@/passenger/pages/account/Help'))
const Notifications = lazy(() => import('@/passenger/pages/Notifications'))
const SharedRideTracking = lazy(() => import('@/passenger/pages/SharedRideTracking'))

// Rotas do fluxo de passageiro.
// Mantidas exatamente como estavam em App.jsx: mesmos paths e mesmos wrappers.
// Fase A da experiência de corrida ativa (2026-08-03): '/riding' agora é protegida —
// era pública, então após um refresh o UserDataContext ficava vazio, o join do socket
// nunca rodava e a tela perdia os eventos de fim de corrida/pagamento. O wrapper
// garante o perfil carregado (e o redirect pro login quando não há sessão).
//
// Otimização de mapa persistente (2026-08-16): Home e as telas de conta abaixo (que
// antes eram rotas irmãs, cada uma com seu próprio UserProtectWrapper) agora são uma
// rota "sem path" (layout route do React Router) com Home como elemento e as telas de
// conta como filhas, renderizadas via <Outlet /> dentro de Home. Isso resolve dois
// problemas ao mesmo tempo: o mapa (LiveTracking) parava de existir e era recriado do
// zero — instância nova do Google Maps, marcadores, motoristas próximos, rota — toda
// vez que o passageiro ia em Carteira/Perfil/etc. e voltava; e o UserProtectWrapper
// refazia GET /users/profile a cada troca de tela dentro desse grupo. Home nunca
// desmonta mais entre essas telas — só ao trocar de corrida ativa, encomenda, agendar
// ou logout, que continuam rotas separadas de propósito (usam o mapa de outro jeito).
const passengerRoutes = [
  <Route key='shared-ride-tracking' path='/track/:token' element={<SharedRideTracking />} />,
  <Route key='login' path='/login' element={<UserLogin />} />,
  <Route key='signup' path='/signup' element={<UserSignup />} />,
  <Route key='riding' path='/riding' element={
    <UserProtectWrapper>
      <Riding />
    </UserProtectWrapper>
  } />,

  <Route key='encomenda' path='/encomenda' element={
    <UserProtectWrapper>
      <ParcelWizard />
    </UserProtectWrapper>
  } />,
  <Route key='encomenda-ativa' path='/encomenda/ativa' element={
    <UserProtectWrapper>
      <ParcelActive />
    </UserProtectWrapper>
  } />,
  <Route key='agendar' path='/agendar' element={
    <UserProtectWrapper>
      <ScheduleHub />
    </UserProtectWrapper>
  } />,
  <Route key='agendar-corrida' path='/agendar/corrida' element={
    <UserProtectWrapper>
      <ScheduleRide />
    </UserProtectWrapper>
  } />,
  <Route key='user-logout' path='/user/logout' element={
    <UserProtectWrapper>
      <UserLogout />
    </UserProtectWrapper>
  } />,

  <Route key='home-shell' element={
    <UserProtectWrapper>
      <Home />
    </UserProtectWrapper>
  }>
    <Route path='/home' element={null} />
    <Route path='/notifications' element={<Notifications />} />
    <Route path='/activity' element={<Activity />} />
    <Route path='/account' element={<Account />} />
    <Route path='/wallet' element={<Wallet />} />
    <Route path='/coupons' element={<Coupons />} />
    <Route path='/profile' element={<Profile />} />
    <Route path='/profile/personal-data' element={<PersonalData />} />
    <Route path='/profile/change-password' element={<ChangePassword />} />
    <Route path='/profile/delete-account' element={<DeleteAccount />} />
    <Route path='/profile/terms' element={<Terms />} />
    <Route path='/profile/privacy' element={<Privacy />} />
    <Route path='/cards' element={<Cards />} />
    <Route path='/scheduled' element={<Scheduled />} />
    <Route path='/favorites' element={<Favorites />} />
    <Route path='/help' element={<Help />} />
  </Route>,
]

export default passengerRoutes
