import React, { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'
import { createParcel, getParcelFare } from '@/shared/services/parcelApi'

const SIZE_LABEL = { small: 'Pequeno', medium: 'Médio', large: 'Grande' }
const CATEGORIES = [
  { id: 'documento', label: 'Documento' },
  { id: 'caixa', label: 'Caixa' },
  { id: 'compras', label: 'Compras' },
  { id: 'comida', label: 'Comida' },
  { id: 'outros', label: 'Outros' },
]

// Ordem do plano: Origem → Destino → Veículo → Objeto → Compatibilidade → Tarifa → Confirmar
const STEPS = ['pickup', 'destination', 'vehicle', 'item', 'people', 'fare']

const ParcelWizard = () => {
  const navigate = useNavigate()
  const { user } = useContext(UserDataContext)
  const { setUserParcel, userRide, userParcel } = useContext(RideContext)
  const { addToast } = useToast()
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (userRide) {
      addToast('Finalize a corrida atual antes de pedir uma encomenda.', 'info')
      navigate('/home', { replace: true })
      return
    }
    if (userParcel) {
      navigate('/encomenda/ativa', { state: { parcel: userParcel }, replace: true })
    }
  }, [userRide, userParcel, navigate, addToast])
  const [loading, setLoading] = useState(false)
  const [fareInfo, setFareInfo] = useState(null)
  const [form, setForm] = useState({
    pickup: '',
    destination: '',
    vehicleType: '',
    itemName: '',
    category: 'documento',
    weightKg: '1',
    size: 'small',
    description: '',
    notes: '',
    sender: {
      name: `${user?.fullname?.firstname || ''} ${user?.fullname?.lastname || ''}`.trim(),
      phone: user?.phone || user?.mobile || '',
    },
    recipient: { name: '', phone: '' },
  })

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setNested = (key, sub, value) =>
    setForm((f) => ({ ...f, [key]: { ...f[key], [sub]: value } }))

  const next = async () => {
    const current = STEPS[step]
    if (current === 'pickup' && form.pickup.trim().length < 3) {
      return addToast('Informe o endereço de retirada', 'error')
    }
    if (current === 'destination' && form.destination.trim().length < 3) {
      return addToast('Informe o endereço de entrega', 'error')
    }
    if (current === 'vehicle' && !form.vehicleType) {
      return addToast('Escolha moto ou carro', 'error')
    }
    if (current === 'item') {
      if (form.itemName.trim().length < 2) return addToast('Nome do objeto obrigatório', 'error')
      if (Number(form.weightKg) < 0) return addToast('Peso inválido', 'error')
    }
    if (current === 'people') {
      if (form.sender.name.trim().length < 2 || form.sender.phone.trim().length < 8) {
        return addToast('Dados do remetente incompletos', 'error')
      }
      if (form.recipient.name.trim().length < 2 || form.recipient.phone.trim().length < 8) {
        return addToast('Dados do destinatário incompletos', 'error')
      }
      setLoading(true)
      try {
        const data = await getParcelFare({
          pickup: form.pickup,
          destination: form.destination,
          vehicleType: form.vehicleType,
          size: form.size,
          weightKg: form.weightKg,
        })
        setFareInfo(data)
        if (data.warnings?.length) {
          data.warnings.forEach((w) => addToast(w, 'info'))
        }
        if (data.blocked) {
          addToast('Troque para carro para continuar com este item', 'error')
          setLoading(false)
          return
        }
      } catch (err) {
        addToast(err.response?.data?.message || 'Falha ao calcular tarifa', 'error')
        setLoading(false)
        return
      }
      setLoading(false)
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const back = () => {
    if (step === 0) return navigate('/home')
    setStep((s) => s - 1)
  }

  const confirm = async () => {
    if (fareInfo?.blocked) {
      return addToast('Veículo incompatível com o item', 'error')
    }
    setLoading(true)
    try {
      const parcel = await createParcel({
        pickup: form.pickup,
        destination: form.destination,
        vehicleType: form.vehicleType,
        itemName: form.itemName,
        category: form.category,
        weightKg: Number(form.weightKg),
        size: form.size,
        description: form.description,
        notes: form.notes,
        sender: form.sender,
        recipient: form.recipient,
        paymentMethod: 'cash',
      })
      setUserParcel(parcel)
      addToast('Encomenda solicitada!', 'success')
      navigate('/encomenda/ativa', { state: { parcel } })
    } catch (err) {
      addToast(err.response?.data?.message || 'Falha ao criar encomenda', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="px-4 py-3 border-b border-line flex items-center gap-3">
        <button type="button" onClick={back} className="min-h-[40px] min-w-[40px]" aria-label="Voltar">
          <i className="ri-arrow-left-line text-xl text-ink-900" />
        </button>
        <h1 className="text-lg font-semibold text-ink-900">Encomenda</h1>
      </header>

      <main className="flex-1 p-4 pb-28 max-w-lg mx-auto w-full">
        {STEPS[step] === 'pickup' && (
          <section>
            <h2 className="text-xl font-semibold text-ink-900 mb-2">Onde retirar?</h2>
            <input
              className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3"
              placeholder="Endereço de retirada"
              value={form.pickup}
              onChange={(e) => setField('pickup', e.target.value)}
            />
          </section>
        )}

        {STEPS[step] === 'destination' && (
          <section>
            <h2 className="text-xl font-semibold text-ink-900 mb-2">Onde entregar?</h2>
            <input
              className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3"
              placeholder="Endereço de entrega"
              value={form.destination}
              onChange={(e) => setField('destination', e.target.value)}
            />
          </section>
        )}

        {STEPS[step] === 'vehicle' && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-ink-900 mb-2">Tipo de veículo</h2>
            {[
              {
                id: 'moto',
                title: 'Moto',
                points: ['Mais rápida', 'Mais econômica', 'Para pequenos volumes'],
              },
              {
                id: 'car',
                title: 'Carro',
                points: ['Objetos grandes', 'Muitas caixas', 'Compras maiores', 'Itens frágeis'],
              },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setField('vehicleType', opt.id)}
                className={`w-full text-left border rounded-panel p-4 ${
                  form.vehicleType === opt.id ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface'
                }`}
              >
                <p className="font-semibold text-ink-900 text-lg">{opt.title}</p>
                <ul className="mt-2 text-sm text-ink-600 space-y-1">
                  {opt.points.map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              </button>
            ))}
          </section>
        )}

        {STEPS[step] === 'item' && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-ink-900 mb-2">Dados do objeto</h2>
            <input
              className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3"
              placeholder="Nome do objeto"
              value={form.itemName}
              onChange={(e) => setField('itemName', e.target.value)}
            />
            <select
              className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3"
              value={form.category}
              onChange={(e) => setField('category', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.1"
              className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3"
              placeholder="Peso aproximado (kg)"
              value={form.weightKg}
              onChange={(e) => setField('weightKg', e.target.value)}
            />
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SIZE_LABEL).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setField('size', id)}
                  className={`py-3 rounded-panel border font-medium ${
                    form.size === id ? 'border-brand-500 bg-brand-50' : 'border-line'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3 min-h-[90px]"
              placeholder="Descreva sua encomenda"
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
            />
            <textarea
              className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3 min-h-[90px]"
              placeholder="Observações (interfone, apto, portão…)"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </section>
        )}

        {STEPS[step] === 'people' && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-ink-900">Remetente e destinatário</h2>
            <div>
              <p className="text-sm font-medium text-ink-600 mb-2">Remetente</p>
              <input
                className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3 mb-2"
                placeholder="Nome"
                value={form.sender.name}
                onChange={(e) => setNested('sender', 'name', e.target.value)}
              />
              <input
                className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3"
                placeholder="Telefone"
                value={form.sender.phone}
                onChange={(e) => setNested('sender', 'phone', e.target.value)}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-600 mb-2">Destinatário</p>
              <input
                className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3 mb-2"
                placeholder="Nome"
                value={form.recipient.name}
                onChange={(e) => setNested('recipient', 'name', e.target.value)}
              />
              <input
                className="w-full bg-surface-alt border border-line rounded-panel px-4 py-3"
                placeholder="Telefone"
                value={form.recipient.phone}
                onChange={(e) => setNested('recipient', 'phone', e.target.value)}
              />
            </div>
          </section>
        )}

        {STEPS[step] === 'fare' && fareInfo && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-ink-900">Confirmar encomenda</h2>
            <div className="bg-surface-alt border border-line rounded-panel p-4 space-y-2 text-sm">
              <p><span className="text-ink-400">Veículo:</span> {form.vehicleType}</p>
              <p><span className="text-ink-400">Retirada:</span> {form.pickup}</p>
              <p><span className="text-ink-400">Entrega:</span> {form.destination}</p>
              <p><span className="text-ink-400">Item:</span> {form.itemName} ({SIZE_LABEL[form.size]})</p>
              <p className="text-2xl font-bold text-ink-900 pt-2">
                R$ {Number(fareInfo.fare).toFixed(2).replace('.', ',')}
              </p>
              <p className="text-xs text-ink-400">Entrega imediata (Agora)</p>
            </div>
            {fareInfo.warnings?.length > 0 && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-panel p-3">
                {fareInfo.warnings.map((w) => <p key={w}>{w}</p>)}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 p-4 bg-surface border-t border-line">
        <div className="max-w-lg mx-auto">
          {STEPS[step] !== 'fare' ? (
            <button
              type="button"
              disabled={loading}
              onClick={next}
              className="w-full min-h-[48px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50"
            >
              Continuar
            </button>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={confirm}
              className="w-full min-h-[48px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50"
            >
              {loading ? 'Enviando…' : 'Confirmar encomenda'}
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

export default ParcelWizard
