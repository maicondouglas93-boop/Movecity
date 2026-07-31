import { Route } from 'react-router-dom'

import UserLogin from '@/modules/passenger/pages/UserLogin'
import UserSignup from '@/modules/passenger/pages/UserSignup'
import UserLogout from '@/modules/passenger/pages/UserLogout'
import UserProtectWrapper from '@/modules/passenger/pages/UserProtectWrapper'
import Home from '@/modules/passenger/pages/Home'
import Riding from '@/modules/passenger/pages/Riding'
import Activity from '@/modules/passenger/pages/Activity'
import Account from '@/modules/passenger/pages/account/Account'
import Wallet from '@/modules/passenger/pages/account/Wallet'
import Coupons from '@/modules/passenger/pages/account/Coupons'
import Profile from '@/modules/passenger/pages/account/Profile'
import PersonalData from '@/modules/passenger/pages/account/PersonalData'
import ChangePassword from '@/modules/passenger/pages/account/ChangePassword'
import DeleteAccount from '@/modules/passenger/pages/account/DeleteAccount'
import Terms from '@/modules/passenger/pages/account/Terms'
import Privacy from '@/modules/passenger/pages/account/Privacy'
import Cards from '@/modules/passenger/pages/account/Cards'
import Scheduled from '@/modules/passenger/pages/account/Scheduled'
import Favorites from '@/modules/passenger/pages/account/Favorites'
import Help from '@/modules/passenger/pages/account/Help'

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
