import { useState } from 'react'
import api from '@/shared/services/axios'
import Button from '@/shared/components/ui/Button'
import LegalPage from './LegalPage'

const AccountDeletionRequest = () => {
  const [email, setEmail] = useState('')
  const [accountType, setAccountType] = useState('user')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')
    try {
      const response = await api.post('/account-deletion/request', { email, accountType })
      setMessage(response.data?.message || 'Solicitação recebida para verificação.')
      setEmail('')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Não foi possível enviar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <LegalPage title="Excluir conta">
      <div className="rounded-panel bg-warning-50 border border-warning-500/20 p-4 mb-6 text-sm leading-6 text-warning-800">Dentro do app, acesse o perfil da sua conta para solicitar a exclusão autenticada. O acesso é desativado imediatamente e os dados pessoais são apagados ou anonimizados em até 30 dias.</div>
      <p className="text-sm leading-6 text-ink-600 mb-6">Sem acesso ao app, envie o pedido abaixo. Para sua segurança, o suporte confirmará a identidade antes de desativar a conta. O pedido não pode ser concluído durante uma corrida ou encomenda ativa.</p>
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className="font-semibold mb-2">Tipo de conta</legend>
          <div className="grid grid-cols-2 gap-3">
            {[[ 'user', 'Passageiro' ], [ 'captain', 'Motorista' ]].map(([value, label]) => (
              <label key={value} className={`rounded-panel border p-3 text-center font-semibold cursor-pointer ${accountType === value ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-line'}`}>
                <input className="sr-only" type="radio" name="accountType" value={value} checked={accountType === value} onChange={() => setAccountType(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="font-semibold block mb-2">E-mail da conta</span>
          <input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-panel border border-line bg-surface px-4 py-3 outline-none focus:border-brand-500" placeholder="email@exemplo.com" />
        </label>
        {message && <p role="status" className="rounded-panel bg-brand-50 p-4 text-sm text-brand-800">{message}</p>}
        {error && <p role="alert" className="rounded-panel bg-danger-50 p-4 text-sm text-danger-700">{error}</p>}
        <Button type="submit" loading={loading}>Enviar solicitação</Button>
      </form>
    </LegalPage>
  )
}

export default AccountDeletionRequest
