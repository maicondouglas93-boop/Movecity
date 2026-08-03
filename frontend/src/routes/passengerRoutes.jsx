import { lazy } from 'react'
import { Route } from 'react-router-dom'

import UserLogin from '@/modules/passenger/pages/UserLogin'
import UserSignup from '@/modules/passenger/pages/UserSignup'
import UserLogout from '@/modules/passenger/pages/UserLogout'
import UserProtectWrapper from '@/modules/passenger/pages/UserProtectWrapper'
import Home from '@/modules/passenger/pages/Home'
import Riding from '@/modules/passenger/pages/Riding'

// Auditoria PWA (2026-08-03, B6): login/cadastro, Home e Riding ficam estáticos —
// são o caminho mais comum de toda sessão, carregar sob demanda só adicionaria uma
// viagem de rede extra bem na hora mais sensível. As telas de conta (uso ocasional,
// nenhuma delas faz parte do fluxo de pedir/fazer uma corrida) entram sob demanda —
// hoje elas iam todas no mesmo bundle inicial de ~1,17MB mesmo sem ninguém abrir
// "Ajuda" ou "Termos" naquela sessão.
const Activity = lazy(() => import('@/modules/passenger/pages/Activity'))
const Account = lazy(() => import('@/modules/passenger/pages/account/Account'))
const Wallet = lazy(() => import('@/modules/passenger/pages/account/Wallet'))
const Coupons = lazy(() => import('@/modules/passenger/pages/account/Coupons'))
const Profile = lazy(() => import('@/modules/passenger/pages/account/Profile'))
const PersonalData = lazy(() => import('@/modules/passenger/pages/account/PersonalData'))
const ChangePassword = lazy(() => import('@/modules/passenger/pages/account/ChangePassword'))
const DeleteAccount = lazy(() => import('@/modules/passenger/pages/account/DeleteAccount'))
const Terms = lazy(() => import('@/modules/passenger/pages/account/Terms'))
const Privacy = lazy(() => import('@/modules/passenger/pages/account/Privacy'))
const Cards = lazy(() => import('@/modules/passenger/pages/account/Cards'))
const Scheduled = lazy(() => import('@/modules/passenger/pages/account/Scheduled'))
const Favorites = lazy(() => import('@/modules/passenger/pages/account/Favorites'))
const Help = lazy(() => import('@/modules/passenger/pages/account/Help'))

// Rotas do fluxo de passageiro.
// Mantidas exatamente como estavam em App.jsx: mesmos paths e mesmos wrappers.
// Observacao: '/riding' segue publica (sem UserProtectWrapper), como no original.
const passengerRoutes = [
  <Route key='login' path='/login' element={<UserLogin />} />,
  <Route key='signup' path='/signup' element={<UserSignup />} />,
  <Route key='riding' path='/riding' element={<Riding />} />,

  <Route key='home' path='/home' element={
    <UserProtectWrapper>
      <Home />
    </UserProtectWrapper>
  } />,
  <Route key='user-logout' path='/user/logout' element={
    <UserProtectWrapper>
      <UserLogout />
    </UserProtectWrapper>
  } />,
  <Route key='activity' path='/activity' element={
    <UserProtectWrapper>
      <Activity />
    </UserProtectWrapper>
  } />,
  <Route key='account' path='/account' element={
    <UserProtectWrapper>
      <Account />
    </UserProtectWrapper>
  } />,
  <Route key='wallet' path='/wallet' element={
    <UserProtectWrapper>
      <Wallet />
    </UserProtectWrapper>
  } />,
  <Route key='coupons' path='/coupons' element={
    <UserProtectWrapper>
      <Coupons />
    </UserProtectWrapper>
  } />,
  <Route key='profile' path='/profile' element={
    <UserProtectWrapper>
      <Profile />
    </UserProtectWrapper>
  } />,
  <Route key='profile-personal-data' path='/profile/personal-data' element={
    <UserProtectWrapper>
      <PersonalData />
    </UserProtectWrapper>
  } />,
  <Route key='profile-change-password' path='/profile/change-password' element={
    <UserProtectWrapper>
      <ChangePassword />
    </UserProtectWrapper>
  } />,
  <Route key='profile-delete-account' path='/profile/delete-account' element={
    <UserProtectWrapper>
      <DeleteAccount />
    </UserProtectWrapper>
  } />,
  <Route key='profile-terms' path='/profile/terms' element={
    <UserProtectWrapper>
      <Terms />
    </UserProtectWrapper>
  } />,
  <Route key='profile-privacy' path='/profile/privacy' element={
    <UserProtectWrapper>
      <Privacy />
    </UserProtectWrapper>
  } />,
  <Route key='cards' path='/cards' element={
    <UserProtectWrapper>
      <Cards />
    </UserProtectWrapper>
  } />,
  <Route key='scheduled' path='/scheduled' element={
    <UserProtectWrapper>
      <Scheduled />
    </UserProtectWrapper>
  } />,
  <Route key='favorites' path='/favorites' element={
    <UserProtectWrapper>
      <Favorites />
    </UserProtectWrapper>
  } />,
  <Route key='help' path='/help' element={
    <UserProtectWrapper>
      <Help />
    </UserProtectWrapper>
  } />,
]

export default passengerRoutes
