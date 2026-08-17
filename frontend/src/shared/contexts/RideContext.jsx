import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { getAccessToken, onSessionChanged } from '@/shared/services/session'
import { onAppActive } from '@/shared/platform/appLifecycle.service'

// Fase A da experiência de corrida ativa (2026-08-03) + restore de encomenda.
//
// Fonte única de reconciliação da corrida/encomenda ativa com o backend. Antes, o estado
// vivia espalhado em useState local + location.state do React Router — que
// não sobrevivem a refresh, fechamento do PWA nem retorno do background.
//
// Regras deste contexto:
// - O BACKEND é a fonte da verdade: toda abertura/reconexão/retorno consulta
//   /rides/current, /rides/captain-current, /parcels/current e /parcels/captain-current.
// - O socket apenas ATUALIZA o estado — nunca é a única fonte.
// - Sessão dupla (passageiro e motorista no mesmo navegador) é suportada.
export const RideContext = createContext()

const RIDE_ENDPOINT_BY_KIND = {
    user: '/rides/current',
    captain: '/rides/captain-current',
}

const PARCEL_ENDPOINT_BY_KIND = {
    user: '/parcels/current',
    captain: '/parcels/captain-current',
}

const UNKNOWN = undefined

const RIDE_STATUS_RANK = {
    scheduled: 0,
    requested: 1,
    accepted: 2,
    going_to_pickup: 3,
    arrived: 4,
    waiting_passenger: 5,
    started: 6,
    finished: 7,
    cancelled: 7,
}

function isRideRegression(previous, next) {
    if (!previous || !next?._id) return false
    if (String(previous._id) !== String(next._id)) return false

    const previousRank = RIDE_STATUS_RANK[previous.status] ?? -1
    const nextRank = RIDE_STATUS_RANK[next.status] ?? -1
    return nextRank >= 0 && previousRank > nextRank
}

function mergeRideByStatus(previous, next) {
    if (typeof next === 'function') {
        return mergeRideByStatus(previous, next(previous))
    }
    if (isRideRegression(previous, next)) {
        if (import.meta.env.DEV) {
            console.info(
                `[RideContext] Ignorando snapshot antigo da corrida ${next._id}: ${previous.status} → ${next.status}`
            )
        }
        return previous
    }
    return next
}

const PARCEL_RESTORE_STATUSES = [
    'awaiting_provider',
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
    'delivered',
    'finished',
]

async function fetchActive(kind, endpointMap) {
    const token = getAccessToken(kind)
    if (!token) return null

    try {
        // Cliente centralizado: 401 → refresh automático; falha de refresh → forceLogout.
        const response = await api.get(endpointMap[kind])
        return response.data || null
    } catch (err) {
        if (err.response?.status === 404) return null
        return UNKNOWN
    }
}

const RideProvider = ({ children }) => {
    const [ userRide, setUserRide ] = useState(null)
    const [ captainRide, setCaptainRideState ] = useState(null)
    const [ userParcel, setUserParcel ] = useState(null)
    const [ captainParcel, setCaptainParcel ] = useState(null)
    const { socket } = useContext(SocketContext)
    const navigate = useNavigate()
    const location = useLocation()

    const syncSeqRef = useRef({ user: 0, captain: 0, userParcel: 0, captainParcel: 0 })

    // `force` ignora a proteção anti-retrocesso. Ela existe pra um snapshot antigo não
    // sobrescrever um estado mais avançado, mas quando uma ação offline falha em
    // definitivo o estado otimista do app é que está errado — e o guarda passa a
    // IMPEDIR o estado correto do servidor de entrar, deixando a tela mostrando uma
    // corrida em andamento que o backend não tem.
    const syncRide = useCallback(async (kind, { force = false } = {}) => {
        const seq = ++syncSeqRef.current[kind]
        const result = await fetchActive(kind, RIDE_ENDPOINT_BY_KIND)
        if (seq !== syncSeqRef.current[kind]) return result
        if (result !== UNKNOWN) {
            if (kind === 'user') setUserRide(result)
            else if (force) setCaptainRideState(result)
            else setCaptainRideState(previous => mergeRideByStatus(previous, result))
        }
        return result
    }, [])

    const syncParcel = useCallback(async (kind) => {
        const key = kind === 'user' ? 'userParcel' : 'captainParcel'
        const seq = ++syncSeqRef.current[key]
        const result = await fetchActive(kind, PARCEL_ENDPOINT_BY_KIND)
        if (seq !== syncSeqRef.current[key]) return result
        if (result !== UNKNOWN) {
            if (kind === 'user') setUserParcel(result)
            else setCaptainParcel(result)
        }
        return result
    }, [])

    const syncUserRide = useCallback(() => syncRide('user'), [syncRide])
    const syncCaptainRide = useCallback(() => syncRide('captain'), [syncRide])
    const syncUserParcel = useCallback(() => syncParcel('user'), [syncParcel])
    const syncCaptainParcel = useCallback(() => syncParcel('captain'), [syncParcel])

    const setCaptainRide = useCallback((nextRide) => {
        setCaptainRideState(previous => mergeRideByStatus(previous, nextRide))
    }, [])

    // Uma ação offline (aceitar/iniciar/finalizar) que falhou em definitivo deixa o app
    // exibindo um estado que o servidor nunca chegou a ter. Só um aviso não bastava: o
    // guarda anti-retrocesso segurava o estado otimista até o app ser reaberto, e nada
    // dizia isso ao motorista. Evento de janela porque SocketProvider envolve este
    // contexto e não consegue chamá-lo direto — mesmo padrão do listener de 'online'.
    useEffect(() => {
        const resyncFromServer = () => {
            syncRide('captain', { force: true }).catch(() => {})
            syncParcel('captain').catch(() => {})
        }
        window.addEventListener('offline-action-failed', resyncFromServer)
        return () => window.removeEventListener('offline-action-failed', resyncFromServer)
    }, [syncRide, syncParcel])

    const clearUserRide = useCallback(() => {
        setUserRide(null)
    }, [])

    const clearUserParcel = useCallback(() => {
        setUserParcel(null)
    }, [])

    useEffect(() => {
        const syncAll = () => {
            syncRide('user')
            syncRide('captain')
            syncParcel('user')
            syncParcel('captain')
        }

        syncAll()

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') syncAll()
        }
        const handlePageShow = (event) => {
            if (event.persisted) syncAll()
        }
        const handleSessionChanged = () => {
            if (!getAccessToken('user')) {
                setUserRide(null)
                setUserParcel(null)
            }
            if (!getAccessToken('captain')) {
                setCaptainRideState(null)
                setCaptainParcel(null)
            }
            syncAll()
        }

        socket.on('connect', syncAll)
        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('pageshow', handlePageShow)
        window.addEventListener('online', syncAll)
        const offSessionChanged = onSessionChanged(handleSessionChanged)
        // Capacitor: appStateChange → active (além de visibilitychange do WebView).
        const offAppActive = onAppActive(syncAll)

        return () => {
            socket.off('connect', syncAll)
            document.removeEventListener('visibilitychange', handleVisibility)
            window.removeEventListener('pageshow', handlePageShow)
            window.removeEventListener('online', syncAll)
            offSessionChanged()
            offAppActive?.()
        }
    }, [socket, syncRide, syncParcel])

    const redirectedJobsRef = useRef(new Set())

    useEffect(() => {
        const path = location.pathname

        if (userRide?.status === 'started') {
            const key = `user-ride:${userRide._id}`
            if (path === '/riding') {
                redirectedJobsRef.current.add(key)
            } else if ((path === '/home' || path === '/') && !redirectedJobsRef.current.has(key)) {
                redirectedJobsRef.current.add(key)
                navigate('/riding', { state: { ride: userRide } })
                return
            }
        }

        if (captainRide?.status === 'started') {
            const key = `captain-ride:${captainRide._id}`
            if (path === '/captain-riding') {
                redirectedJobsRef.current.add(key)
            } else if ((path === '/captain-home' || path === '/') && !redirectedJobsRef.current.has(key)) {
                redirectedJobsRef.current.add(key)
                if (import.meta.env.DEV) {
                    console.info('[RideOfferFlow] NAVIGATION_TARGET=/captain-riding CURRENT_RIDE_STATUS=started')
                }
                navigate('/captain-riding', { state: { ride: captainRide } })
                return
            }
        }

        // Proteção: accepted/pré-início NUNCA deve ficar em /captain-riding
        // (deep link nativo legado pós-aceite). ConfirmRidePopUp vive na home.
        const captainPreStart = [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger' ]
        if (
            captainRide
            && captainPreStart.includes(captainRide.status)
            && path === '/captain-riding'
        ) {
            const key = `captain-prestart-guard:${captainRide._id}:${captainRide.status}`
            if (!redirectedJobsRef.current.has(key)) {
                redirectedJobsRef.current.add(key)
                const target = captainRide.source === 'driver_initiated'
                    ? '/captain-presential'
                    : '/captain-home'
                console.info(
                    `[RideOfferFlow] NAVIGATION_TARGET=${target} CURRENT_RIDE_STATUS=${captainRide.status} (guard from /captain-riding)`
                )
                navigate(target, { replace: true, state: { ride: captainRide } })
                return
            }
        }

        // Presencial pré-início: reconduz ao wizard do PIN de qualquer tela do motorista.
        if (
            captainRide?.source === 'driver_initiated'
            && captainPreStart.includes(captainRide.status)
        ) {
            const key = `captain-presential:${captainRide._id}`
            if (path === '/captain-presential') {
                redirectedJobsRef.current.add(key)
            } else if (
                path.startsWith('/captain')
                && !redirectedJobsRef.current.has(key)
            ) {
                redirectedJobsRef.current.add(key)
                navigate('/captain-presential', { replace: true })
                return
            }
        }

        // Wizard bloqueado se já há ride/parcel ativo.
        if (path === '/encomenda') {
            if (userRide) {
                navigate(userRide.status === 'started' ? '/riding' : '/home', { state: { ride: userRide }, replace: true })
                return
            }
            if (userParcel && PARCEL_RESTORE_STATUSES.includes(userParcel.status)) {
                navigate('/encomenda/ativa', { state: { parcel: userParcel }, replace: true })
                return
            }
        }

        // Encomenda ativa: restore para tela dedicada (uma vez por parcel).
        if (userParcel && PARCEL_RESTORE_STATUSES.includes(userParcel.status) && !userRide) {
            const key = `user-parcel:${userParcel._id}`
            if (path === '/encomenda/ativa') {
                redirectedJobsRef.current.add(key)
            } else if ((path === '/home' || path === '/') && !redirectedJobsRef.current.has(key)) {
                redirectedJobsRef.current.add(key)
                navigate('/encomenda/ativa', { state: { parcel: userParcel } })
                return
            }
        }

        if (
            captainParcel
            && PARCEL_RESTORE_STATUSES.includes(captainParcel.status)
            && !captainRide
        ) {
            const key = `captain-parcel:${captainParcel._id}`
            if (path === '/captain-parcel') {
                redirectedJobsRef.current.add(key)
            } else if ((path === '/captain-home' || path === '/') && !redirectedJobsRef.current.has(key)) {
                redirectedJobsRef.current.add(key)
                navigate('/captain-parcel', {
                    state: {
                        parcel: captainParcel,
                        step: captainParcel.status === 'finished' ? 'rating' : 'active',
                    },
                })
            }
        }
    }, [userRide, captainRide, userParcel, captainParcel, location.pathname, navigate])

    return (
        <RideContext.Provider value={{
            userRide,
            setUserRide,
            captainRide,
            setCaptainRide,
            syncUserRide,
            syncCaptainRide,
            clearUserRide,
            userParcel,
            setUserParcel,
            captainParcel,
            setCaptainParcel,
            syncUserParcel,
            syncCaptainParcel,
            clearUserParcel,
        }}>
            {children}
        </RideContext.Provider>
    )
}

export default RideProvider
