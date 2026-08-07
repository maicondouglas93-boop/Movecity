import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'
import { createParcel, getParcelFare } from '@/shared/services/parcelApi'
import { getVehicleCategories } from '@/shared/services/vehicleCategoriesApi'
import { vehicleImages } from '@/shared/assets/vehicleAssets'
import PageHeader from '@/shared/components/ui/PageHeader'
import Button from '@/shared/components/ui/Button'
import Card from '@/shared/components/ui/Card'
import SelectableOptionCard from '@/shared/components/ui/SelectableOptionCard'
import DetailRow from '@/shared/components/ui/DetailRow'
import AddressAutocomplete from '@/shared/components/ui/AddressAutocomplete'
import { LocationContext } from '@/shared/contexts/LocationContext'

const SIZE_OPTIONS = [
  { id: 'small', label: 'Pequeno', hint: 'Envelope, documentos' },
  { id: 'medium', label: 'Médio', hint: 'Caixa pequena' },
  { id: 'large', label: 'Grande', hint: 'Várias caixas' },
]

const CATEGORIES = [
  { id: 'documento', label: 'Documento' },
  { id: 'caixa', label: 'Caixa' },
  { id: 'compras', label: 'Compras' },
  { id: 'comida', label: 'Comida' },
  { id: 'outros', label: 'Outros' },
]

const fieldClass =
  'w-full bg-surface-alt border border-line rounded-panel px-4 py-3.5 text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-colors'

const labelClass = 'block text-sm font-medium text-ink-600 mb-1.5'

const toLocalInputValue = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const ParcelWizard = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const scheduleMode = Boolean(location.state?.scheduleMode)
  const { user } = useContext(UserDataContext)
  const { setUserParcel, userRide, userParcel } = useContext(RideContext)
  const { userLocation } = useContext(LocationContext)
  const { addToast } = useToast()

  const [loading, setLoading] = useState(false)
  const [fareLoading, setFareLoading] = useState(false)
  const [fareInfo, setFareInfo] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [vehicleCategories, setVehicleCategories] = useState([])
  const [vehiclesLoading, setVehiclesLoading] = useState(true)
  const fareTimer = useRef(null)
  const minSchedule = new Date(Date.now() + 15 * 60 * 1000)
  const vehicleService = scheduleMode ? 'scheduledParcel' : 'parcel'

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
    paymentMethod: 'cash',
    scheduledAt: scheduleMode ? toLocalInputValue(minSchedule) : '',
  })

  useEffect(() => {
    let cancelled = false
    setVehiclesLoading(true)
    getVehicleCategories(vehicleService)
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data) ? data : []
        setVehicleCategories(list)
        setForm((f) => {
          if (f.vehicleType && list.some((c) => c.name === f.vehicleType)) return f
          return { ...f, vehicleType: list[0]?.name || '' }
        })
      })
      .catch(() => {
        if (!cancelled) setVehicleCategories([])
      })
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false)
      })
    return () => { cancelled = true }
  }, [vehicleService])

  useEffect(() => {
    if (!scheduleMode && userRide) {
      addToast('Finalize a corrida atual antes de pedir uma encomenda.', 'info')
      navigate('/home', { replace: true })
      return
    }
    if (!scheduleMode && userParcel) {
      navigate('/encomenda/ativa', { state: { parcel: userParcel }, replace: true })
    }
  }, [userRide, userParcel, navigate, addToast, scheduleMode])

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setNested = (key, sub, value) =>
    setForm((f) => ({ ...f, [key]: { ...f[key], [sub]: value } }))

  const canQuote =
    form.pickup.trim().length >= 3
    && form.destination.trim().length >= 3
    && form.vehicleType

  const refreshFare = useCallback(async () => {
    if (!canQuote) {
      setFareInfo(null)
      return
    }
    setFareLoading(true)
    try {
      const data = await getParcelFare({
        pickup: form.pickup.trim(),
        destination: form.destination.trim(),
        vehicleType: form.vehicleType,
        size: form.size,
        weightKg: form.weightKg,
      })
      setFareInfo(data)
      if (data.blocked) {
        const msg = data.warnings?.[0]
          || (form.vehicleType === 'moto'
            ? 'Este item não cabe na moto — escolha carro.'
            : 'Este item não cabe no carro — escolha outro veículo ou reduza o item.')
        addToast(msg, 'error')
      }
    } catch (err) {
      setFareInfo(null)
      addToast(err.response?.data?.message || 'Não foi possível calcular o preço.', 'error')
    } finally {
      setFareLoading(false)
    }
  }, [canQuote, form.pickup, form.destination, form.vehicleType, form.size, form.weightKg, addToast])

  useEffect(() => {
    if (fareTimer.current) clearTimeout(fareTimer.current)
    if (!canQuote) {
      setFareInfo(null)
      return undefined
    }
    fareTimer.current = setTimeout(() => {
      refreshFare()
    }, 550)
    return () => {
      if (fareTimer.current) clearTimeout(fareTimer.current)
    }
  }, [canQuote, form.pickup, form.destination, form.vehicleType, form.size, form.weightKg, refreshFare])

  const validate = () => {
    if (form.pickup.trim().length < 3) return 'Informe o local de coleta'
    if (form.destination.trim().length < 3) return 'Informe o endereço de entrega'
    if (!form.vehicleType) return 'Escolha um veículo'
    if (form.itemName.trim().length < 2) return 'Descreva o que será entregue'
    const weight = Number(form.weightKg)
    if (Number.isNaN(weight) || weight < 0 || weight > 100) return 'Informe um peso válido (0–100 kg)'
    if (form.sender.name.trim().length < 2 || form.sender.phone.trim().length < 8) {
      return 'Complete os dados de quem envia'
    }
    if (form.recipient.name.trim().length < 2 || form.recipient.phone.trim().length < 8) {
      return 'Complete os dados de quem recebe'
    }
    if (fareInfo?.blocked) {
      return form.vehicleType === 'moto'
        ? 'Este item não cabe na moto — escolha carro ou reduza peso/tamanho.'
        : 'Este item não cabe no carro — reduza peso/tamanho ou altere o veículo.';
    }
    if (!fareInfo?.fare) return 'Aguarde o cálculo do preço'
    if (scheduleMode) {
      if (!form.scheduledAt) return 'Escolha data e horário'
      const at = new Date(form.scheduledAt)
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 14 * 60 * 1000) {
        return 'Agende com pelo menos 15 minutos de antecedência'
      }
    }
    return null
  }

  const confirm = async () => {
    const error = validate()
    if (error) return addToast(error, 'error')

    setLoading(true)
    try {
      const payload = {
        pickup: form.pickup.trim(),
        destination: form.destination.trim(),
        vehicleType: form.vehicleType,
        itemName: form.itemName.trim(),
        category: form.category,
        weightKg: Number(form.weightKg),
        size: form.size,
        description: form.description.trim(),
        notes: form.notes.trim(),
        sender: {
          name: form.sender.name.trim(),
          phone: form.sender.phone.trim(),
        },
        recipient: {
          name: form.recipient.name.trim(),
          phone: form.recipient.phone.trim(),
        },
        paymentMethod: form.paymentMethod,
      }
      if (scheduleMode && form.scheduledAt) {
        payload.scheduledAt = new Date(form.scheduledAt).toISOString()
      }
      const parcel = await createParcel(payload)
      if (scheduleMode || parcel.status === 'scheduled') {
        addToast('Encomenda agendada!', 'success')
        navigate('/scheduled')
        return
      }
      setUserParcel(parcel)
      addToast('Encomenda solicitada!', 'success')
      navigate('/encomenda/ativa', { state: { parcel } })
    } catch (err) {
      addToast(err.response?.data?.message || 'Não foi possível solicitar a entrega.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const sizeLabel = SIZE_OPTIONS.find((s) => s.id === form.size)?.label || form.size
  const vehicleLabel =
    vehicleCategories.find((c) => c.name === form.vehicleType)?.displayName
    || (form.vehicleType === 'moto' ? 'Moto' : form.vehicleType === 'car' ? 'Carro' : '—')

  return (
    <div className="min-h-screen bg-surface-alt flex flex-col">
      <PageHeader
        title={scheduleMode ? 'Agendar encomenda' : 'Nova encomenda'}
        onBack={() => navigate(scheduleMode ? '/agendar' : '/home')}
      />

      <main className="flex-1 w-full max-w-xl mx-auto px-4 pt-4 pb-36 space-y-4">
        <p className="text-sm text-ink-400 px-0.5">
          {scheduleMode
            ? 'Informe rota, item e o horário. Começamos a buscar motorista cerca de 10 minutos antes do horário.'
            : 'Informe coleta, entrega e o que precisa enviar. O preço aparece ao preencher a rota.'}
        </p>

        {/* Rota */}
        <Card shadow="raised" className="space-y-4">
          <h2 className="text-base font-semibold text-ink-900">Rota</h2>
          <AddressAutocomplete
            id="parcel-pickup"
            label="Coleta"
            value={form.pickup}
            onChange={(v) => setField('pickup', v)}
            placeholder="Ex.: avenida Antônio Florêncio Alvim, 754"
            biasLocation={userLocation}
            icon="ri-map-pin-user-fill"
            inputClassName={`${fieldClass} pl-10 pr-10`}
          />
          <AddressAutocomplete
            id="parcel-destination"
            label="Entrega"
            value={form.destination}
            onChange={(v) => setField('destination', v)}
            placeholder="Ex.: travessa João Caetano, 99"
            biasLocation={userLocation}
            icon="ri-map-pin-2-fill"
            iconClassName="text-danger-500"
            inputClassName={`${fieldClass} pl-10 pr-10`}
          />
        </Card>

        {/* Veículo — só categorias com allowedServices.parcel / scheduledParcel */}
        <Card shadow="raised" className="space-y-3">
          <h2 className="text-base font-semibold text-ink-900">Veículo</h2>
          {vehiclesLoading ? (
            <div className="flex justify-center py-4">
              <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true" />
            </div>
          ) : vehicleCategories.length === 0 ? (
            <p className="text-sm text-ink-400 text-center py-3">
              Nenhuma categoria disponível para encomendas no momento.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {vehicleCategories.map((cat) => (
                <SelectableOptionCard
                  key={cat._id || cat.name}
                  selected={form.vehicleType === cat.name}
                  onClick={() => setField('vehicleType', cat.name)}
                  icon={(
                    <img
                      className="h-9 w-12 object-contain"
                      src={vehicleImages[cat.iconKey] || vehicleImages[cat.name] || vehicleImages.car}
                      alt=""
                      width="1024"
                      height="1024"
                      loading="lazy"
                    />
                  )}
                  title={cat.displayName}
                  subtitle={cat.description || (cat.capacity != null ? `Até ${cat.capacity} vol.` : '')}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Pacote */}
        <Card shadow="raised" className="space-y-4">
          <h2 className="text-base font-semibold text-ink-900">O que vamos entregar?</h2>
          <div>
            <label htmlFor="parcel-item" className={labelClass}>Objeto</label>
            <input
              id="parcel-item"
              className={fieldClass}
              placeholder="Ex.: documentos, roupas, pequena encomenda"
              value={form.itemName}
              onChange={(e) => setField('itemName', e.target.value)}
            />
          </div>

          <div>
            <p className={labelClass} id="parcel-category-label">Categoria</p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="parcel-category-label">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setField('category', c.id)}
                  aria-pressed={form.category === c.id}
                  className={`min-h-[40px] px-3.5 rounded-full text-sm font-medium border transition-colors ${
                    form.category === c.id
                      ? 'bg-brand-50 border-brand-500 text-brand-700'
                      : 'bg-surface border-line text-ink-600'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={labelClass} id="parcel-size-label">Tamanho</p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="parcel-size-label">
              {SIZE_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setField('size', s.id)}
                  aria-pressed={form.size === s.id}
                  className={`rounded-panel border-2 px-2 py-3 text-center transition-colors active:scale-[0.98] ${
                    form.size === s.id
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-line bg-surface-alt'
                  }`}
                >
                  <p className="text-sm font-semibold text-ink-900">{s.label}</p>
                  <p className="text-[11px] text-ink-400 mt-0.5 leading-tight">{s.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="parcel-weight" className={labelClass}>Peso aproximado (kg)</label>
            <input
              id="parcel-weight"
              type="number"
              min="0"
              max="100"
              step="0.1"
              inputMode="decimal"
              className={fieldClass}
              placeholder="Ex.: 2,5"
              value={form.weightKg}
              onChange={(e) => setField('weightKg', e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="w-full flex items-center justify-between min-h-[44px] text-sm font-medium text-ink-600"
            aria-expanded={detailsOpen}
          >
            <span>Observações e descrição</span>
            <i className={`ri-arrow-${detailsOpen ? 'up' : 'down'}-s-line text-lg`} aria-hidden="true" />
          </button>

          {detailsOpen && (
            <div className="space-y-3 pt-1">
              <div>
                <label htmlFor="parcel-description" className={labelClass}>Descrição</label>
                <textarea
                  id="parcel-description"
                  className={`${fieldClass} min-h-[88px] resize-none`}
                  placeholder="Ex.: envelope com contratos, frágil"
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  rows={3}
                />
              </div>
              <div>
                <label htmlFor="parcel-notes" className={labelClass}>Observações para o prestador</label>
                <textarea
                  id="parcel-notes"
                  className={`${fieldClass} min-h-[88px] resize-none`}
                  placeholder="Ex.: Deixar na portaria · interfone 12"
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
        </Card>

        {/* Contatos */}
        <Card shadow="raised" className="space-y-4">
          <h2 className="text-base font-semibold text-ink-900">Quem envia e quem recebe</h2>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Remetente</p>
            <div>
              <label htmlFor="sender-name" className={labelClass}>Nome</label>
              <input
                id="sender-name"
                className={fieldClass}
                placeholder="Seu nome completo"
                value={form.sender.name}
                onChange={(e) => setNested('sender', 'name', e.target.value)}
                autoComplete="name"
              />
            </div>
            <div>
              <label htmlFor="sender-phone" className={labelClass}>Telefone</label>
              <input
                id="sender-phone"
                className={fieldClass}
                placeholder="Telefone com DDD"
                value={form.sender.phone}
                onChange={(e) => setNested('sender', 'phone', e.target.value)}
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
          </div>
          <div className="border-t border-line pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Destinatário</p>
            <div>
              <label htmlFor="recipient-name" className={labelClass}>Nome</label>
              <input
                id="recipient-name"
                className={fieldClass}
                placeholder="Nome de quem vai receber"
                value={form.recipient.name}
                onChange={(e) => setNested('recipient', 'name', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="recipient-phone" className={labelClass}>Telefone</label>
              <input
                id="recipient-phone"
                className={fieldClass}
                placeholder="Telefone do destinatário"
                value={form.recipient.phone}
                onChange={(e) => setNested('recipient', 'phone', e.target.value)}
                inputMode="tel"
              />
            </div>
          </div>
        </Card>

        {scheduleMode && (
          <Card shadow="raised" className="space-y-2">
            <h2 className="text-base font-semibold text-ink-900">Data e horário</h2>
            <input
              type="datetime-local"
              className={fieldClass}
              min={toLocalInputValue(minSchedule)}
              value={form.scheduledAt}
              onChange={(e) => setField('scheduledAt', e.target.value)}
            />
            <p className="text-xs text-ink-400">
              Mínimo 15 minutos · máximo 7 dias. Busca inicia ~10 min antes.
            </p>
          </Card>
        )}

        <Card shadow="raised" className="space-y-3">
          <h2 className="text-base font-semibold text-ink-900">Pagamento ao prestador</h2>
          <p className="text-sm text-ink-500">Você paga diretamente no momento da entrega.</p>
          <div className="space-y-2">
            <SelectableOptionCard
              selected={form.paymentMethod === 'cash'}
              onClick={() => setField('paymentMethod', 'cash')}
              title="Dinheiro"
              subtitle="Em espécie na entrega"
              icon={<i className="ri-money-dollar-circle-line text-2xl text-ink-900" aria-hidden="true" />}
            />
            <SelectableOptionCard
              selected={form.paymentMethod === 'pix'}
              onClick={() => setField('paymentMethod', 'pix')}
              title="Pix"
              subtitle="Direto ao prestador"
              icon={<i className="ri-qr-code-line text-2xl text-ink-900" aria-hidden="true" />}
            />
          </div>
        </Card>

        {/* Resumo */}
        <Card shadow="raised" className="space-y-1">
          <h2 className="text-base font-semibold text-ink-900 mb-2">Resumo</h2>
          <DetailRow
            icon="ri-map-pin-user-fill"
            title="Coleta"
            subtitle={form.pickup.trim() || 'Ainda não informado'}
          />
          <DetailRow
            icon="ri-map-pin-2-fill"
            iconColor="text-danger-500"
            title="Entrega"
            subtitle={form.destination.trim() || 'Ainda não informado'}
          />
          <DetailRow
            icon="ri-box-3-line"
            title={form.itemName.trim() || 'Objeto'}
            subtitle={`${sizeLabel} · ${vehicleLabel}${form.weightKg ? ` · ${form.weightKg} kg` : ''}`}
          />
          <div className="flex items-end justify-between pt-3 border-t border-line mt-2">
            <div>
              <p className="text-xs text-ink-400">Estimativa</p>
              {fareLoading ? (
                <p className="text-lg font-semibold text-ink-400 flex items-center gap-2">
                  <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
                  Calculando…
                </p>
              ) : fareInfo?.fare != null ? (
                <p className="text-2xl font-bold text-ink-900">
                  R$ {Number(fareInfo.fare).toFixed(2).replace('.', ',')}
                </p>
              ) : (
                <p className="text-lg font-semibold text-ink-400">—</p>
              )}
            </div>
            <p className="text-xs text-ink-400 pb-1">Entrega agora</p>
          </div>
          {fareInfo?.warnings?.length > 0 && (
            <div className="mt-3 text-sm text-ink-600 bg-surface-alt border border-line rounded-panel px-3 py-2.5 space-y-1" role="status">
              {fareInfo.warnings.map((w) => (
                <p key={w} className="flex gap-2">
                  <i className="ri-information-line text-brand-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          )}
        </Card>
      </main>

      <footer className="fixed bottom-0 inset-x-0 z-panel bg-surface border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-floating">
        <div className="max-w-xl mx-auto">
          <Button
            loading={loading}
            disabled={loading || fareLoading || fareInfo?.blocked}
            onClick={confirm}
          >
            {scheduleMode ? 'Confirmar agendamento' : 'Solicitar entrega'}
            {fareInfo?.fare != null && !fareLoading ? (
              <span className="opacity-90 font-medium">
                · R$ {Number(fareInfo.fare).toFixed(2).replace('.', ',')}
              </span>
            ) : null}
          </Button>
        </div>
      </footer>
    </div>
  )
}

export default ParcelWizard
