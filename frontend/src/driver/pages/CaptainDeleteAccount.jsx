import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import Button from '@/shared/components/ui/Button'
import PageHeader from '@/shared/components/ui/PageHeader'
import { useToast } from '@/shared/contexts/ToastContext'
import { clearSession } from '@/shared/services/session'

const CaptainDeleteAccount = () => {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const confirmed = confirmation.trim().toUpperCase() === 'EXCLUIR'

  const submit = async () => {
    setLoading(true)
    try {
      await api.post('/captains/account-deletion', { confirmation: 'EXCLUIR' })
      clearSession('captain')
      addToast('Conta desativada. A remoção dos dados ocorrerá em até 30 dias.', 'success')
      navigate('/captain-login', { replace: true })
    } catch (error) {
      addToast(error.response?.data?.message || 'Não foi possível solicitar a exclusão.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <PageHeader title="Excluir conta" onBack={() => navigate('/captain/profile')} />
      <main className="max-w-xl mx-auto p-5">
        <div className="rounded-panel border border-danger-500/20 bg-danger-50 p-4 mb-6 flex gap-3">
          <i className="ri-error-warning-fill text-2xl text-danger-500" aria-hidden="true" />
          <div>
            <h2 className="font-bold text-danger-700">Sua conta será desativada agora</h2>
            <p className="text-sm leading-6 text-danger-600 mt-1">Você ficará offline, não receberá novas corridas e todas as sessões serão encerradas. Seus dados pessoais e documentos serão apagados ou anonimizados em até 30 dias, exceto quando houver obrigação de conservação.</p>
          </div>
        </div>
        <p className="text-sm leading-6 text-ink-600 mb-6">Finalize ou cancele qualquer corrida ou encomenda ativa antes de continuar. A solicitação não poderá ser desfeita pelo aplicativo.</p>
        <label className="font-semibold block mb-2">Para confirmar, digite <span className="text-danger-600">EXCLUIR</span>:</label>
        <input
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          placeholder="EXCLUIR"
          className="w-full rounded-panel border border-line bg-surface px-4 py-3 text-center font-bold uppercase tracking-widest outline-none focus:border-danger-500"
        />
        <Button variant="dangerSolid" className="mt-6" disabled={!confirmed} loading={loading} onClick={submit}>Sim, excluir minha conta</Button>
      </main>
    </div>
  )
}

export default CaptainDeleteAccount
