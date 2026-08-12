import { lazy } from 'react'
import { Route } from 'react-router-dom'

const PrivacyPolicy = lazy(() => import('@/shared/pages/legal/PrivacyPolicy'))
const PublicSupport = lazy(() => import('@/shared/pages/legal/PublicSupport'))
const AccountDeletionRequest = lazy(() => import('@/shared/pages/legal/AccountDeletionRequest'))

const legalRoutes = [
  <Route key="privacy-public" path="/privacy" element={<PrivacyPolicy />} />,
  <Route key="support-public" path="/support" element={<PublicSupport />} />,
  <Route key="account-deletion-public" path="/account-deletion" element={<AccountDeletionRequest />} />,
]

export default legalRoutes
