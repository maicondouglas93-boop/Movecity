import React, { useContext } from 'react'
import { Route, Routes } from 'react-router-dom'
import Start from './pages/Start'
import UserLogin from './pages/UserLogin'
import UserSignup from './pages/UserSignup'
import Captainlogin from './pages/Captainlogin'
import CaptainSignup from './pages/CaptainSignup'
import Home from './pages/Home'
import UserProtectWrapper from './pages/UserProtectWrapper'
import UserLogout from './pages/UserLogout'
import CaptainHome from './pages/CaptainHome'
import CaptainProtectWrapper from './pages/CaptainProtectWrapper'
import CaptainLogout from './pages/CaptainLogout'
import Riding from './pages/Riding'
import CaptainRiding from './pages/CaptainRiding'
import CaptainWallet from './pages/CaptainWallet'
import CaptainRidesHistory from './pages/CaptainRidesHistory'
import CaptainEarnings from './pages/CaptainEarnings'
import CaptainProfile from './pages/CaptainProfile'
import Activity from './pages/Activity'
import Account from './pages/account/Account'
import Wallet from './pages/account/Wallet'
import Coupons from './pages/account/Coupons'
import Profile from './pages/account/Profile'
import PersonalData from './pages/account/PersonalData'
import ChangePassword from './pages/account/ChangePassword'
import DeleteAccount from './pages/account/DeleteAccount'
import Terms from './pages/account/Terms'
import Privacy from './pages/account/Privacy'
import Cards from './pages/account/Cards'
import Scheduled from './pages/account/Scheduled'
import Favorites from './pages/account/Favorites'
import Help from './pages/account/Help'
import 'remixicon/fonts/remixicon.css'
import { ToastProvider } from './context/ToastContext'

const App = () => {

  return (
    <ToastProvider>
      <div>
      <Routes>
        <Route path='/' element={<Start />} />
        <Route path='/login' element={<UserLogin />} />
        <Route path='/riding' element={<Riding />} />
        <Route path='/captain-riding' element={
          <CaptainProtectWrapper>
            <CaptainRiding />
          </CaptainProtectWrapper>
        } />

        <Route path='/signup' element={<UserSignup />} />
        <Route path='/captain-login' element={<Captainlogin />} />
        <Route path='/captain-signup' element={<CaptainSignup />} />
        <Route path='/home'
          element={
            <UserProtectWrapper>
              <Home />
            </UserProtectWrapper>
          } />
        <Route path='/user/logout'
          element={<UserProtectWrapper>
            <UserLogout />
          </UserProtectWrapper>
          } />
        <Route path='/activity'
          element={
            <UserProtectWrapper>
              <Activity />
            </UserProtectWrapper>
          } />
        <Route path='/account'
          element={
            <UserProtectWrapper>
              <Account />
            </UserProtectWrapper>
          } />
        <Route path='/wallet'
          element={
            <UserProtectWrapper>
              <Wallet />
            </UserProtectWrapper>
          } />
        <Route path='/coupons'
          element={
            <UserProtectWrapper>
              <Coupons />
            </UserProtectWrapper>
          } />
        <Route path='/profile'
          element={
            <UserProtectWrapper>
              <Profile />
            </UserProtectWrapper>
          } />
        <Route path='/profile/personal-data'
          element={
            <UserProtectWrapper>
              <PersonalData />
            </UserProtectWrapper>
          } />
        <Route path='/profile/change-password'
          element={
            <UserProtectWrapper>
              <ChangePassword />
            </UserProtectWrapper>
          } />
        <Route path='/profile/delete-account'
          element={
            <UserProtectWrapper>
              <DeleteAccount />
            </UserProtectWrapper>
          } />
        <Route path='/profile/terms'
          element={
            <UserProtectWrapper>
              <Terms />
            </UserProtectWrapper>
          } />
        <Route path='/profile/privacy'
          element={
            <UserProtectWrapper>
              <Privacy />
            </UserProtectWrapper>
          } />
        <Route path='/cards'
          element={
            <UserProtectWrapper>
              <Cards />
            </UserProtectWrapper>
          } />
        <Route path='/scheduled'
          element={
            <UserProtectWrapper>
              <Scheduled />
            </UserProtectWrapper>
          } />
        <Route path='/favorites'
          element={
            <UserProtectWrapper>
              <Favorites />
            </UserProtectWrapper>
          } />
        <Route path='/help'
          element={
            <UserProtectWrapper>
              <Help />
            </UserProtectWrapper>
          } />
        <Route path='/captain-home' element={
          <CaptainProtectWrapper>
            <CaptainHome />
          </CaptainProtectWrapper>
        } />
        <Route path='/captain-wallet' element={
          <CaptainProtectWrapper>
            <CaptainWallet />
          </CaptainProtectWrapper>
        } />
        <Route path='/captain/logout' element={
          <CaptainProtectWrapper>
            <CaptainLogout />
          </CaptainProtectWrapper>
        } />
        <Route path='/captain/wallet' element={
          <CaptainProtectWrapper>
            <CaptainWallet />
          </CaptainProtectWrapper>
        } />
        <Route path='/captain/rides' element={
          <CaptainProtectWrapper>
            <CaptainRidesHistory />
          </CaptainProtectWrapper>
        } />
        <Route path='/captain/earnings' element={
          <CaptainProtectWrapper>
            <CaptainEarnings />
          </CaptainProtectWrapper>
        } />
        <Route path='/captain/profile' element={
          <CaptainProtectWrapper>
            <CaptainProfile />
          </CaptainProtectWrapper>
        } />
      </Routes>
      </div>
    </ToastProvider>
  )
}

export default App