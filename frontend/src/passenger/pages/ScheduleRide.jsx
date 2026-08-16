import { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import PageHeader from '@/shared/components/ui/PageHeader'
import Button from '@/shared/components/ui/Button'
import Card from '@/shared/components/ui/Card'
import SelectableOptionCard from '@/shared/components/ui/SelectableOptionCard'
import AddressAutocomplete from '@/shared/components/ui/AddressAutocomplete'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { getAccessToken } from '@/shared/services/session'
import { useToast } from '@/shared/contexts/ToastContext'
import { getVehicleCategories } from '@/shared/services/vehicleCategoriesApi'
import { vehicleImages } from '@/shared/assets/vehicleAssets'
import { formatCurrencyBRL } from '@/shared/utils/formatters'
import { newIdempotencyKey } from '@/shared/utils/idempotency'

const fieldClass =
  'w-full bg-surface-alt border border-line rounded-panel px-4 py-3.5 text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

const toLocalInputValue = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const ScheduleRide = () => {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { userLocation } = useContext(LocationContext)
  const minDate = new Date(Date.now() + 15 * 60 * 1000)
  const maxDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [vehicleCategories, setVehicleCategories] = useState([])
  const [vehiclesLoading, setVehiclesLoading] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(minDate))
  const [loading, setLoading] = useState(false)
  const [farePreview, setFarePreview] = useState(null)
  const [fareLoading, setFareLoading] = useState(false)
  const rideCreationKeyRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setVehiclesLoading(true)
    getVehicleCategories('scheduledRide')
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data) ? data : []
        setVehicleCategories(list)
        setVehicleType((prev) => (
          prev && list.some((c) => c.name === prev) ? prev : (list[0]?.name || '')
        ))
      })
      .catch(() => {
        if (!cancelled) setVehicleCategories([])
      })
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (pickup.trim().length < 3 || destination.trim().length < 3) {
      setFarePreview(null)
      return
    }
    let alive = true
    const timer = setTimeout(async () => {
      setFareLoading(true)
      try {
        const { data } = await api.get(`${import.meta.env.VITE_BASE_URL}/rides/get-fare`, {
          params: { pickup: pickup.trim(), destination: destination.trim() },
          headers: { Authorization: `Bearer ${getAccessToken('user')}` },
        })
        if (alive) setFarePreview(data)
      } catch {
        if (alive) setFarePreview(null)
      } finally {
        if (alive) setFareLoading(false)
      }
    }, 450)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [pickup, destination])

  const confirm = async () => {
    if (pickup.trim().length < 3 || destination.trim().length < 3) {
      return addToast('Informe coleta e destino', 'error')
    }
    if (!vehicleType) {
      return addToast('Escolha um veículo', 'error')
    }
    if (!scheduledAt) {
      return addToast('Escolha data e horário', 'error')
    }
    const at = new Date(scheduledAt)
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 14 * 60 * 1000) {
      return addToast('Agende com pelo menos 15 minutos de antecedência', 'error')
    }
    if (at.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000) {
      return addToast('Agende com no máximo 7 dias de antecedência', 'error')
    }

    setLoading(true)
    const payload = {
      pickup: pickup.trim(),
      destination: destination.trim(),
      vehicleType,
      paymentMethod,
      scheduledAt: at.toISOString(),
    }
    const requestFingerprint = JSON.stringify(payload)
    if (rideCreationKeyRef.current?.fingerprint !== requestFingerprint) {
      rideCreationKeyRef.current = {
        fingerprint: requestFingerprint,
        key: newIdempotencyKey(),
      }
    }
    try {
      await api.post(
        `${import.meta.env.VITE_BASE_URL}/rides/create`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${getAccessToken('user')}`,
            'Idempotency-Key': rideCreationKeyRef.current.key,
          },
        },
      )
      rideCreationKeyRef.current = null
      addToast('Corrida agendada!', 'success')
      navigate('/scheduled')
    } catch (err) {
      if (err.response?.status && err.response.status < 500) {
        rideCreationKeyRef.current = null
      }
      addToast(err.response?.data?.message || 'Não foi possível agendar', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fareValue = farePreview?.fare?.[vehicleType]

  return (
    <div className="min-h-screen bg-surface-alt flex flex-col pb-28">
      <PageHeader title="Agendar corrida" onBack={() => navigate('/agendar')} />
      <main className="flex-1 px-4 py-4 max-w-xl mx-auto w-full space-y-3">
        <p className="text-sm text-ink-500 px-0.5">
          Começamos a buscar motorista cerca de 10 minutos antes do horário.
        </p>

        <Card shadow="raised" className="space-y-3">
          <AddressAutocomplete
            id="schedule-pickup"
            label="Coleta"
            value={pickup}
            onChange={setPickup}
            placeholder="Ex.: avenida Antônio Florêncio Alvim, 754"
            biasLocation={userLocation}
            icon="ri-map-pin-user-fill"
            inputClassName={`${fieldClass} pl-10 pr-10`}
          />
          <AddressAutocomplete
            id="schedule-destination"
            label="Destino"
            value={destination}
            onChange={setDestination}
            placeholder="Ex.: travessa João Caetano, 99"
            biasLocation={userLocation}
            icon="ri-map-pin-2-fill"
            iconClassName="text-danger-500"
            inputClassName={`${fieldClass} pl-10 pr-10`}
          />

          <label className="block">
            <span className="text-sm font-medium text-ink-600 mb-1.5 block">Data e horário</span>
            <input
              type="datetime-local"
              className={fieldClass}
              min={toLocalInputValue(minDate)}
              max={toLocalInputValue(maxDate)}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
          <p className="text-xs text-ink-400">Mínimo 15 minutos · máximo 7 dias</p>
        </Card>

        <Card shadow="raised" className="space-y-2">
          <h2 className="text-base font-semibold text-ink-900">Veículo</h2>
          {vehiclesLoading ? (
            <div className="flex justify-center py-4">
              <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true" />
            </div>
          ) : vehicleCategories.length === 0 ? (
            <p className="text-sm text-ink-400 text-center py-3">
              Nenhuma categoria disponível para corridas agendadas.
            </p>
          ) : (
            vehicleCategories.map((cat) => (
              <SelectableOptionCard
                key={cat._id || cat.name}
                selected={vehicleType === cat.name}
                onClick={() => setVehicleType(cat.name)}
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
                subtitle={cat.description}
              />
            ))
          )}
        </Card>

        <Card shadow="raised" className="space-y-2">
          <h2 className="text-base font-semibold text-ink-900">Pagamento</h2>
          <SelectableOptionCard
            selected={paymentMethod === 'cash'}
            onClick={() => setPaymentMethod('cash')}
            icon={<i className="ri-money-dollar-circle-line text-2xl" aria-hidden="true" />}
            title="Dinheiro"
          />
          <SelectableOptionCard
            selected={paymentMethod === 'pix'}
            onClick={() => setPaymentMethod('pix')}
            icon={<i className="ri-qr-code-line text-2xl" aria-hidden="true" />}
            title="Pix"
          />
        </Card>

        {(fareLoading || fareValue != null) && (
          <Card shadow="raised" className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-600">Prévia da tarifa</p>
            <p className="text-base font-semibold text-ink-900">
              {fareLoading
                ? 'Calculando…'
                : formatCurrencyBRL(fareValue)}
            </p>
          </Card>
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-surface border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto">
          <Button loading={loading} disabled={loading} onClick={confirm}>
            Confirmar agendamento
            {!fareLoading && fareValue != null ? (
              <span className="opacity-90 font-medium">
                {' '}· {formatCurrencyBRL(fareValue)}
              </span>
            ) : null}
          </Button>
        </div>
      </footer>
    </div>
  )
}

export default ScheduleRide
