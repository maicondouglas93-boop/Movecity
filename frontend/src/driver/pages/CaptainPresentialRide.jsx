import React, { useContext, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import CaptainHeader from '@/driver/components/CaptainHeader'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import Button from '@/shared/components/ui/Button'
import AddressAutocomplete from '@/shared/components/ui/AddressAutocomplete'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { useToast } from '@/shared/contexts/ToastContext'
import { getAccessToken } from '@/shared/services/session'
import {
  createPresentialRide,
  estimatePresentialFare,
  getPresentialVehicleOptions,
  startPresentialRide,
} from '@/shared/services/presentialRideApi'
import { formatBRL } from '@/shared/utils/currency'

// Falha de sinal não tem `response`, então a mensagem padrão do catch ("não foi
// possível...") mandava o motorista desistir de algo que talvez tenha dado certo do
// outro lado. Sem rede a orientação é outra: esperar sinal e conferir, não refazer.
const semRede = (err) => err?.isConnectivityIssue === true

const STEPS = {
  CHOICE: 'choice',
  DESTINATION: 'destination',
  CONFIRM: 'confirm',
  PIN: 'pin',
}

const vehicleIcon = (iconKey) =>
  ['moto', 'motorcycle'].includes(String(iconKey || '').toLowerCase())
    ? 'ri-motorbike-fill'
    : 'ri-car-fill'

function formatKm(meters) {
  if (meters == null) return '—'
  return `${(Number(meters) / 1000).toFixed(1)} km`
}

function formatMin(seconds) {
  if (seconds == null) return '—'
  return `${Math.max(1, Math.round(Number(seconds) / 60))} min`
}

const CaptainPresentialRide = () => {
  const navigate = useNavigate()
  const { userLocation, locationError } = useContext(LocationContext)
  const { setCaptainRide, captainRide, captainParcel, syncCaptainRide } = useContext(RideContext)
  const { socket } = useContext(SocketContext)
  const { addToast } = useToast()

  const [step, setStep] = useState(STEPS.CHOICE)
  const [destinationPending, setDestinationPending] = useState(false)
  const [destination, setDestination] = useState('')
  const [estimate, setEstimate] = useState(null)
  const [estimating, setEstimating] = useState(false)
  const [ride, setRide] = useState(null)
  const [otpInput, setOtpInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [passengerPhone, setPassengerPhone] = useState('')
  const [passengerConsent, setPassengerConsent] = useState(false)
  // Motorista autorizado a carro E moto tem um único veículo cadastrado — sem esta
  // escolha o preço saía sempre na categoria do cadastro, independente do que ele
  // estivesse dirigindo. Com uma categoria só, nada é perguntado.
  const [vehicleOptions, setVehicleOptions] = useState([])
  const [vehicleType, setVehicleType] = useState(null)

  const needsVehicleChoice = vehicleOptions.length > 1

  useEffect(() => {
    let cancelled = false
    getPresentialVehicleOptions()
      .then((options) => {
        if (cancelled) return
        const list = Array.isArray(options) ? options : []
        setVehicleOptions(list)
        if (list.length === 1) setVehicleType(list[0].name)
      })
      .catch(() => {
        // Sem a lista, o backend resolve pela categoria do cadastro (comportamento antigo).
      })
    return () => { cancelled = true }
  }, [])

  const selectVehicle = (name) => {
    setVehicleType(name)
    setEstimate(null)
  }

  const GPS_MAX_AGE_MS = 60_000
  const hasFreshGps = () => {
    if (locationError) return false
    if (userLocation?.lat == null || userLocation?.lng == null) return false
    if (userLocation.timestamp && (Date.now() - userLocation.timestamp) > GPS_MAX_AGE_MS) return false
    return true
  }

  useEffect(() => {
    if (!socket) return undefined
    const handleRideCancelled = (data) => {
      const activeId = ride?._id || captainRide?._id
      if (activeId && data?.rideId && String(data.rideId) !== String(activeId)) return
      setCaptainRide(null)
      setRide(null)
      addToast(
        data?.cancelledBy === 'admin'
          ? 'Corrida cancelada pelo administrador.'
          : 'A corrida foi cancelada pelo passageiro.',
        'info',
      )
      navigate('/captain-home', { replace: true })
    }
    socket.on('ride-cancelled', handleRideCancelled)
    return () => socket.off('ride-cancelled', handleRideCancelled)
  }, [socket, ride?._id, captainRide?._id, setCaptainRide, addToast, navigate])

  useEffect(() => {
    if (captainParcel) {
      navigate('/captain-parcel', { state: { parcel: captainParcel }, replace: true })
      return
    }
    if (captainRide && captainRide.source !== 'driver_initiated') {
      if (captainRide.status === 'started') {
        navigate('/captain-riding', { state: { ride: captainRide }, replace: true })
      } else {
        navigate('/captain-home', { replace: true })
      }
      return
    }
    if (captainRide && [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ].includes(captainRide.status)) {
      if (captainRide.source === 'driver_initiated' && captainRide.status !== 'started') {
        setRide(captainRide)
        setStep(STEPS.PIN)
      } else if (captainRide.status === 'started') {
        navigate('/captain-riding', { state: { ride: captainRide }, replace: true })
      }
    }
  }, [captainRide, captainParcel, navigate])

  const coordsPayload = () => ({
    ...(userLocation?.lat != null ? { lat: userLocation.lat, lng: userLocation.lng } : {}),
  })

  const chooseNow = () => {
    setDestinationPending(false)
    setStep(STEPS.DESTINATION)
  }

  const chooseLater = () => {
    setDestinationPending(true)
    setDestination('')
    setEstimate(null)
    setStep(STEPS.CONFIRM)
  }

  const confirmDestination = async (address) => {
    const resolved = String(address || '').trim()
    if (resolved.length < 3) {
      addToast('Informe o endereço de destino', 'error')
      return
    }
    setDestination(resolved)
    setEstimating(true)
    try {
      const data = await estimatePresentialFare({
        destination: resolved,
        vehicleType,
        ...coordsPayload(),
      })
      setEstimate(data)
      setStep(STEPS.CONFIRM)
    } catch (err) {
      addToast(
        semRede(err)
          ? 'Sem sinal para calcular o valor. Procure um ponto com rede e tente de novo.'
          : (err.response?.data?.message || 'Não foi possível estimar a tarifa.'),
        'error',
      )
    } finally {
      setEstimating(false)
    }
  }

  const createRide = async () => {
    if (locationError) {
      addToast(`GPS necessário: ${locationError}`, 'error')
      return
    }
    if (!hasFreshGps()) {
      addToast('Aguardando GPS atualizado. Ative a localização e tente de novo.', 'error')
      return
    }
    if (needsVehicleChoice && !vehicleType) {
      addToast('Escolha o veículo desta corrida.', 'error')
      return
    }
    setLoading(true)
    try {
      const payload = {
        destinationPending,
        paymentMethod: 'cash',
        ...(vehicleType ? { vehicleType } : {}),
        ...coordsPayload(),
      }
      if (!destinationPending) {
        payload.destination = destination.trim()
      }
      if (passengerPhone.trim()) {
        payload.passengerPhone = passengerPhone.trim()
      }
      const created = await createPresentialRide(payload)
      setRide(created)
      setCaptainRide(created)
      setStep(STEPS.PIN)
      addToast('Corrida criada. Informe o PIN ao passageiro.', 'success')
    } catch (err) {
      // A corrida já existe e é dele (tentativa anterior que ficou sem resposta): em vez
      // de mostrar um erro e deixá-lo tentando de novo contra um índice único, sincroniza
      // e cai direto no passo do PIN — que é onde ele precisava chegar.
      if (err.response?.data?.code === 'PRESENTIAL_ALREADY_OPEN') {
        addToast('Esta corrida já estava aberta. Informe o PIN ao passageiro.', 'info')
        try {
          const atual = await syncCaptainRide()
          if (atual?._id) setRide(atual)
        } catch { /* sem rede: o efeito de restauração assume quando o contexto sincronizar */ }
        setStep(STEPS.PIN)
        return
      }
      addToast(
        semRede(err)
          // Aqui a corrida PODE ter sido criada e a resposta se perdido no caminho — por
          // isso o texto não manda tentar de novo às cegas. Ao recuperar sinal, o próprio
          // app restaura a corrida em aberto no passo do PIN.
          ? 'Sem sinal ao criar a corrida. Ao voltar a rede, confira se ela já foi aberta antes de criar outra.'
          : (err.response?.data?.message || 'Não foi possível criar a corrida.'),
        'error',
      )
    } finally {
      setLoading(false)
    }
  }

  const confirmPin = async (e) => {
    e.preventDefault()
    if (!ride?._id) return
    if (!passengerConsent) {
      addToast('Confirme que o passageiro autorizou a corrida.', 'error')
      return
    }
    if (!otpInput || otpInput.length !== 6) {
      addToast('Peça o PIN ao passageiro e digite os 6 dígitos.', 'error')
      return
    }
    setLoading(true)
    try {
      const started = await startPresentialRide({ rideId: ride._id, otp: otpInput })
      setCaptainRide(started)
      navigate('/captain-riding', { state: { ride: started } })
    } catch (err) {
      addToast(
        semRede(err)
          ? 'Sem sinal para iniciar a corrida. Tente de novo assim que a rede voltar.'
          : (err.response?.data?.message || 'PIN inválido.'),
        'error',
      )
    } finally {
      setLoading(false)
    }
  }

  const cancelCreated = async () => {
    if (!ride?._id) {
      navigate('/captain-home')
      return
    }
    setLoading(true)
    try {
      await api.post(
        `${import.meta.env.VITE_BASE_URL}/rides/captain-cancel`,
        { rideId: ride._id, reason: 'Cancelamento de corrida presencial' },
        { headers: { Authorization: `Bearer ${getAccessToken('captain')}` } }
      )
      setCaptainRide(null)
      navigate('/captain-home')
    } catch (err) {
      addToast(err.response?.data?.message || 'Não foi possível cancelar.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-alt">
      <ConnectionBanner />
      <div className="flex-1 overflow-y-auto overscroll-y-contain pb-24 pt-16 px-4">
        <div className="flex items-center gap-3 mb-5 mt-2">
          <Link
            to="/captain-home"
            aria-label="Voltar"
            className="h-10 w-10 rounded-full bg-surface border border-line flex items-center justify-center"
          >
            <i className="ri-arrow-left-line text-lg text-ink-900" aria-hidden="true" />
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Corrida presencial</p>
            <h1 className="text-xl font-bold text-ink-900 leading-tight">Iniciar sem despacho</h1>
          </div>
        </div>

        {step === STEPS.CHOICE && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600 mb-4">
              Use quando o passageiro já estiver com você. A corrida não aparece para outros motoristas.
            </p>

            {needsVehicleChoice && (
              <div className="mb-4">
                <p className="text-sm font-medium text-ink-600 mb-2">Qual veículo você está usando agora?</p>
                <div className="grid grid-cols-2 gap-2">
                  {vehicleOptions.map((option) => {
                    const selected = vehicleType === option.name
                    return (
                      <button
                        key={option.name}
                        type="button"
                        onClick={() => selectVehicle(option.name)}
                        aria-pressed={selected}
                        className={`flex flex-col items-center gap-1 rounded-panel border-2 p-3 min-h-[88px] justify-center transition-transform active:scale-[0.98] ${
                          selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface'
                        }`}
                      >
                        <i className={`${vehicleIcon(option.iconKey)} text-2xl ${selected ? 'text-brand-600' : 'text-ink-600'}`} aria-hidden="true" />
                        <span className="text-sm font-semibold text-ink-900 text-center leading-tight">
                          {option.displayName}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-ink-400 mt-2">A tarifa é calculada pela categoria escolhida.</p>
              </div>
            )}

            <button
              type="button"
              onClick={chooseNow}
              disabled={needsVehicleChoice && !vehicleType}
              className="w-full text-left bg-surface border border-line rounded-panel p-4 active:scale-[0.99] transition-transform disabled:opacity-50 disabled:active:scale-100"
            >
              <p className="text-base font-semibold text-ink-900 flex items-center gap-2">
                <i className="ri-map-pin-2-fill text-brand-500" aria-hidden="true" />
                Informar destino agora
              </p>
              <p className="text-xs text-ink-600 mt-1">Calculamos a estimativa antes de iniciar.</p>
            </button>
            <button
              type="button"
              onClick={chooseLater}
              disabled={needsVehicleChoice && !vehicleType}
              className="w-full text-left bg-surface border border-line rounded-panel p-4 active:scale-[0.99] transition-transform disabled:opacity-50 disabled:active:scale-100"
            >
              <p className="text-base font-semibold text-ink-900 flex items-center gap-2">
                <i className="ri-route-fill text-brand-500" aria-hidden="true" />
                Definir destino ao finalizar
              </p>
              <p className="text-xs text-ink-600 mt-1">Ideal para “pode me levar até ali”.</p>
            </button>
          </div>
        )}

        {step === STEPS.DESTINATION && (
          <div className="space-y-3">
            <AddressAutocomplete
              id="presential-destination"
              label="Destino"
              value={destination}
              onChange={setDestination}
              onResolved={confirmDestination}
              placeholder="Digite o endereço de destino"
              biasLocation={userLocation}
              disabled={estimating}
              icon="ri-map-pin-2-fill"
              inputClassName="w-full min-h-[48px] pl-10 pr-10 rounded-panel border border-line bg-surface text-ink-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            {destination.trim().length >= 3 && (
              <Button
                type="button"
                onClick={() => confirmDestination(destination.trim())}
                loading={estimating}
                disabled={estimating}
              >
                Usar este endereço
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setStep(STEPS.CHOICE)}>
              Voltar
            </Button>
          </div>
        )}

        {step === STEPS.CONFIRM && (
          <div className="space-y-4">
            <div className="bg-surface border border-line rounded-panel p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Resumo</p>
              {needsVehicleChoice && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-ink-900 flex items-center gap-2">
                    <i
                      className={`${vehicleIcon(vehicleOptions.find((o) => o.name === vehicleType)?.iconKey)} text-brand-600`}
                      aria-hidden="true"
                    />
                    {vehicleOptions.find((o) => o.name === vehicleType)?.displayName || vehicleType}
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep(STEPS.CHOICE)}
                    className="text-xs font-semibold text-brand-600 underline"
                  >
                    Trocar
                  </button>
                </div>
              )}
              {destinationPending ? (
                <p className="text-sm text-ink-900">
                  Destino: <span className="font-semibold">será definido ao finalizar</span>
                </p>
              ) : (
                <>
                  <p className="text-sm text-ink-900 break-words">{destination}</p>
                  {estimate && (
                    <div className="flex gap-4 text-sm text-ink-600 pt-1">
                      <span>{formatKm(estimate.estimatedDistance)}</span>
                      <span>{formatMin(estimate.estimatedTime)}</span>
                      <span className="font-semibold text-ink-900">
                        {formatBRL(estimate.fare)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-600 mb-1" htmlFor="passenger-phone">
                Telefone do passageiro (opcional)
              </label>
              <input
                id="passenger-phone"
                type="tel"
                value={passengerPhone}
                onChange={(e) => setPassengerPhone(e.target.value)}
                placeholder="+55…"
                className="w-full min-h-[48px] px-4 rounded-panel border border-line bg-surface text-ink-900"
              />
              <p className="text-xs text-ink-400 mt-1">Se cadastrado no MoveCity, vinculamos ao histórico dele.</p>
            </div>

            <Button type="button" onClick={createRide} loading={loading} disabled={loading || estimating}>
              Confirmar e gerar PIN
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(destinationPending ? STEPS.CHOICE : STEPS.DESTINATION)}
              className="w-full"
            >
              Voltar
            </Button>
          </div>
        )}

        {step === STEPS.PIN && ride && (
          <div className="space-y-4">
            <div className="bg-brand-50 border border-brand-200 rounded-panel p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 mb-2">
                PIN do passageiro
              </p>
              <p className="text-4xl font-bold tracking-[0.35em] text-ink-900 tabular-nums">
                {ride.otp || '······'}
              </p>
              <p className="text-xs text-ink-600 mt-3">
                Mostre este PIN ao passageiro. Ele deve confirmar verbalmente. Em seguida digite o PIN no campo abaixo — não inicie sem a autorização dele.
              </p>
            </div>

            <label className="flex items-start gap-3 bg-surface border border-line rounded-panel p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={passengerConsent}
                onChange={(e) => setPassengerConsent(e.target.checked)}
                className="mt-1 h-4 w-4 accent-brand-500"
              />
              <span className="text-sm text-ink-900">
                O passageiro autorizou esta corrida presencial e confirmou o PIN comigo.
              </span>
            </label>

            <form onSubmit={confirmPin} className="space-y-3">
              <label className="block text-sm font-medium text-ink-600" htmlFor="confirm-otp">
                Digite o PIN confirmado
              </label>
              <input
                id="confirm-otp"
                inputMode="numeric"
                maxLength={6}
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                className="w-full min-h-[48px] px-4 rounded-panel border border-line bg-surface text-center text-2xl tracking-[0.4em] font-bold text-ink-900"
                placeholder="••••••"
              />
              <Button type="submit" loading={loading} disabled={loading || !passengerConsent}>
                Iniciar corrida
              </Button>
            </form>

            <Button type="button" variant="ghost" onClick={cancelCreated} disabled={loading} className="w-full text-danger-600">
              Cancelar corrida
            </Button>
          </div>
        )}
      </div>
      <CaptainHeader />
    </div>
  )
}

export default CaptainPresentialRide
