import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { SocketContext } from '@/contexts/SocketContext'
import { getAccessToken, onSessionChanged } from '@/services/session'
import { refreshAccessToken } from '@/services/axios'

// Fase A da experiência de corrida ativa (2026-08-03).
//
// Fonte única de reconciliação da corrida ativa com o backend. Antes, o estado da
// corrida vivia espalhado em useState local + location.state do React Router — que
// não sobrevivem a refresh, fechamento do PWA nem retorno do background. O backend
// continuava com a corrida normalmente, mas a interface "perdia" a corrida (PIN,
// botões de status, cancelar, mapa).
//
// Regras deste contexto:
// - O BACKEND é a fonte da verdade: toda abertura/reconexão/retorno consulta
//   /rides/current (passageiro) e /rides/captain-current (motorista) e reconstrói.
// - O socket apenas ATUALIZA o estado (as telas continuam setando userRide/captainRide
//   nos handlers de evento) — nunca é a única fonte.
// - Sessão dupla (passageiro e motorista logados no mesmo navegador, comum em teste)
//   é suportada: cada papel tem seu próprio estado e seu próprio token.
export const RideContext = createContext()

const ENDPOINT_BY_KIND = {
    user: '/rides/current',
    captain: '/rides/captain-current',
}

// Sentinela de "não sei" — erro de rede/servidor NUNCA sobrescreve o estado local
// com null (isso apagaria uma corrida real da tela só porque a consulta falhou).
const UNKNOWN = undefined

async function fetchActiveRide(kind, allowRetry = true) {
    const token = getAccessToken(kind)
    if (!token) return null

    try {
        const response = await axios.get(`${import.meta.env.VITE_BASE_URL}${ENDPOINT_BY_KIND[kind]}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data || null
    } catch (err) {
        // 404 = resposta real do backend: não existe corrida ativa.
        if (err.response?.status === 404) return null
        // Token vencido: renova uma vez pela mesma fila do interceptor REST e tenta de
        // novo. O interceptor global não serve aqui porque /rides/* não identifica o
        // papel pela URL (sessionKindForUrl) e escolheria o token errado em sessão dupla.
        if (err.response?.status === 401 && allowRetry) {
            try {
                await refreshAccessToken(kind)
                return fetchActiveRide(kind, false)
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
    const { socket } = useContext(SocketContext)
    const navigate = useNavigate()
    const location = useLocation()

    // Sequência por papel: se dois syncs se cruzarem (ex.: 'connect' e
    // 'visibilitychange' quase juntos), só o resultado do mais recente é aplicado.
    const syncSeqRef = useRef({ user: 0, captain: 0 })

    const syncRide = useCallback(async (kind) => {
        const seq = ++syncSeqRef.current[kind]
        const result = await fetchActiveRide(kind)
        if (seq !== syncSeqRef.current[kind]) return result
        if (result !== UNKNOWN) {
            if (kind === 'user') setUserRide(result)
            else setCaptainRide(result)
        }
        return result
    }, [])

    const syncUserRide = useCallback(() => syncRide('user'), [syncRide])
    const syncCaptainRide = useCallback(() => syncRide('captain'), [syncRide])

    // Reconciliação: sempre que o app "volta à vida" por qualquer caminho, consulta o
    // backend imediatamente. Cobre: abertura/refresh (mount), reconexão do socket,
    // retorno do background (visibilitychange), restauração do bfcache (pageshow) e
    // volta da internet (online).
    useEffect(() => {
        const syncAll = () => {
            syncRide('user')
            syncRide('captain')
        }

        syncAll()

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') syncAll()
        }
        const handlePageShow = (event) => {
            if (event.persisted) syncAll()
        }
        const handleSessionChanged = () => {
            // Logout limpa na hora (sem esperar rede); login dispara reconciliação.
            if (!getAccessToken('user')) setUserRide(null)
            if (!getAccessToken('captain')) setCaptainRide(null)
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
    }, [socket, syncRide])

    // Redirecionamento de restauração: corrida 'started' não tem como ser exibida na
    // Home — a tela certa é /riding (passageiro) ou /captain-riding (motorista).
    // Uma vez por corrida (ref abaixo): depois do redirect inicial, o usuário pode
    // voltar à Home deliberadamente (as Homes mostram um atalho "voltar à corrida").
    const redirectedRidesRef = useRef(new Set())

    useEffect(() => {
        const path = location.pathname

        if (userRide?.status === 'started') {
            const key = `user:${userRide._id}`
            if (path === '/riding') {
                // Já está na tela certa (fluxo normal): marca como vista pra uma volta
                // deliberada à Home não ser rebatida de volta.
                redirectedRidesRef.current.add(key)
            } else if ((path === '/home' || path === '/') && !redirectedRidesRef.current.has(key)) {
                redirectedRidesRef.current.add(key)
                navigate('/riding', { state: { ride: userRide } })
                return
            }
        }

        if (captainRide?.status === 'started') {
            const key = `captain:${captainRide._id}`
            if (path === '/captain-riding') {
                redirectedRidesRef.current.add(key)
            } else if ((path === '/captain-home' || path === '/') && !redirectedRidesRef.current.has(key)) {
                redirectedRidesRef.current.add(key)
                navigate('/captain-riding', { state: { ride: captainRide } })
            }
        }
    }, [userRide, captainRide, location.pathname, navigate])

    return (
        <RideContext.Provider value={{
            userRide,
            setUserRide,
            captainRide,
            setCaptainRide,
            syncUserRide,
            syncCaptainRide,
        }}>
            {children}
        </RideContext.Provider>
    )
}

export default RideProvider
