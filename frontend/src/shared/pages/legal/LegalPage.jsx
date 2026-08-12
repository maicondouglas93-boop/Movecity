/* eslint-disable react/prop-types */
import { Link, useNavigate } from 'react-router-dom'

const LegalPage = ({ title, children }) => {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-surface-alt text-ink-900">
      <header className="sticky top-0 z-panel bg-surface border-b border-line">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} aria-label="Voltar" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full active:bg-surface-alt">
            <i className="ri-arrow-left-line text-2xl" aria-hidden="true" />
          </button>
          <h1 className="text-lg font-bold">{title}</h1>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-5 pb-12">
        <div className="bg-surface rounded-panel border border-line shadow-raised p-5 sm:p-8">{children}</div>
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-3 mt-6 text-sm font-semibold text-brand-700">
          <Link to="/privacy">Privacidade</Link>
          <Link to="/support">Suporte</Link>
          <Link to="/account-deletion">Excluir conta</Link>
        </nav>
      </main>
    </div>
  )
}

export default LegalPage
