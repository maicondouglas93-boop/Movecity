import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { getAccessToken, onSessionChanged } from '@/shared/services/session'
import { refreshAccessToken } from '@/shared/services/axios'

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

async function fetchActive(kind, endpointMap, allowRetry = true) {
    const token = getAccessToken(kind)
    if (!token) return null

    try {
        const response = await axios.get(`${import.meta.env.VITE_BASE_URL}${endpointMap[kind]}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data || null
    } catch (err) {
        if (err.response?.status === 404) return null
        if (err.response?.status === 401 && allowRetry) {
            try {
                await refreshAccessToken(kind)
                return fetchActive(kind, endpointMap, false)
            } catch {
                return UNKNOWN
            }
        }
        return UNKNOWN
    }
}

const RideProvider = ({ children }) => {
    const [ userRide, setUserRide ] = useState(null)
    const [ captainRide, setCaptainRide ] = useState(null)
    const [ userParcel, setUserParcel ] = useState(null)
    const [ captainParcel, setCaptainParcel ] = useState(null)
    const { socket } = useContext(SocketContext)
    const navigate = useNavigate()
    const location = useLocation()

    const syncSeqRef = useRef({ user: 0, captain: 0, userParcel: 0, captainParcel: 0 })

    const syncRide = useCallback(async (kind) => {
        const seq = ++syncSeqRef.current[kind]
        const result = await fetchActive(kind, RIDE_ENDPOINT_BY_KIND)
        if (seq !== syncSeqRef.current[kind]) return result
        if (result !== UNKNOWN) {
            if (kind === 'user') setUserRide(result)
            else setCaptainRide(result)
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
                setCaptainRide(null)
                setCaptainParcel(null)
            }
            syncAll()
        }

        socket.on('connect', syncAll)
        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('pageshow', handlePageShow)
        window.addEventListener('online', syncAll)
        const offSessionChanged = onSessionChanged(handleSessionChanged)

        return () => {
            socket.off('connect', syncAll)
            document.removeEventListener('visibilitychange', handleVisibility)
            window.removeEventListener('pageshow', handlePageShow)
            window.removeEventListener('online', syncAll)
            offSessionChanged()
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
                navigate('/captain-riding', { state: { ride: captainRide } })
                return
            }
        }

        // Presencial pré-início: reconduz ao wizard do PIN de qualquer tela do motorista.
        if (
            captainRide?.source === 'driver_initiated'
            && [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger' ].includes(captainRide.status)
        ) {
            const key = `captain-presential:${captainRide._id}`
            if (path === '/captain-presential') {
                redirectedJobsRef.current.add(key)
            } else if (
                path.startsWith('/captain')
                && path !== '/captain-riding'
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
