import React, { useContext, useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { getAccessToken, getRefreshToken, clearSession } from '@/services/session'
import { clearTokenInSW } from '@/services/swCommunication'
import { getCurrentFcmToken } from '@/services/fcm'
import { SocketContext } from '@/contexts/SocketContext'
import SessionSplash from '@/shared/components/ui/SessionSplash'

// Auditoria de autenticação e sessão persistente (2026-08-02).
//
// Três problemas corrigidos aqui:
// 1. A chamada rodava no corpo do componente (não num useEffect) — em StrictMode isso
//    dispara duas vezes, e a cada re-render.
// 2. Sem `.catch()`: se o request falhasse, o usuário ficava preso numa tela escrito
//    "UserLogout" para sempre, ainda logado. Sair é uma ação explícita — tem que
//    funcionar mesmo se o servidor não responder.
// 3. Não enviava o refresh token, então a sessão de longa duração sobrevivia ao logout.
//
// Usa axios puro de propósito (não a instância com interceptor): um 401 aqui não deve
// disparar renovação silenciosa — estamos justamente encerrando a sessão.
export const UserLogout = () => {
    const navigate = useNavigate()
    const { socket } = useContext(SocketContext)

    useEffect(() => {
        const token = getAccessToken('user')
        const refreshToken = getRefreshToken('user')

        // A3 da auditoria de push (2026-08-02): desvincula o token FCM deste
        // dispositivo da conta que está saindo, além de limpar o IndexedDB do Service
        // Worker (clearTokenInSW, abaixo) — sem os dois, o próximo usuário do mesmo
        // aparelho continuaria recebendo notificações de quem saiu.
        const unregisterPushToken = async () => {
            try {
                const fcmToken = await getCurrentFcmToken()
                if (fcmToken && token) {
                    await axios.delete(`${import.meta.env.VITE_BASE_URL}/notifications/token`, {
                        headers: { Authorization: `Bearer ${token}` },
                        params: { token: fcmToken },
                        withCredentials: true,
                    })
                }
            } catch {
                // Sair não pode depender disso funcionar.
            }
        }

        Promise.all([
            unregisterPushToken(),
            axios.get(`${import.meta.env.VITE_BASE_URL}/users/logout`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                params: refreshToken ? { refreshToken } : {},
                withCredentials: true,
            }).catch(() => {
                // Falha ao avisar o servidor não pode impedir o usuário de sair do
                // aplicativo. A sessão local é limpa de qualquer forma; o refresh token
                // continua revogável pelo servidor depois.
            })
        ]).finally(() => {
            clearTokenInSW()
            clearSession('user')
            // Auditoria PWA (2026-08-03, A6): o socket é um singleton por aba, nunca
            // recriado — sem desconectar aqui, se outra conta logar na MESMA aba logo
            // em seguida (sem recarregar a página), o join dela reusava esta mesma
            // conexão física, e o registro desta conta no banco podia ficar apontando
            // pra um socketId que agora pertence a outra pessoa. connect() força uma
            // conexão nova (socket.id novo) pra quem usar o app em seguida.
            socket.disconnect()
            socket.connect()
            navigate('/login', { replace: true })
        })
    }, [])

    return <SessionSplash label="Saindo..." />
}

export default UserLogout
