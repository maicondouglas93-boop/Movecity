import { getAccessToken } from '@/shared/services/session'
import { refreshAccessToken } from '@/shared/services/axios'

// Auditoria de regressão de push (2026-08-03, docs/plans/2026-08-03-auditoria-regressao-push.md).
//
// O `join` do Socket.IO passou a exigir um JWT válido (C1/C2 da auditoria PWA) — sem
// isso, qualquer socket podia se anunciar como qualquer usuário/motorista real. Efeito
// colateral: a tela de espera de corrida do motorista não faz nenhuma chamada REST
// periódica, então o access token (15min) pode ficar vencido por tempo indefinido sem
// nada renová-lo. Se o socket cair e reconectar nesse meio-tempo (rede instável, app
// minimizado), o `join` é rejeitado com o token velho e o motorista sai do despacho
// silenciosamente — nunca mais recebe corrida nem notificação, sem nenhum erro visível.
//
// Esta função tenta o `join` com o token atual e, só se ele for rejeitado, renova o
// token (mesma lógica/fila usada pelo interceptor de REST em axios.js) e tenta mais
// uma vez. Se a renovação falhar de verdade (sessão morta), desiste — refreshAccessToken
// já cuida de deslogar nesse caso.
export function joinWithRetry(socket, { userId, userType }, onSuccess) {
    const emitJoin = (token) => new Promise((resolve) => {
        socket.emit('join', { userId, userType, token }, resolve)
    })

    emitJoin(getAccessToken(userType))
        .then(async (ack) => {
            if (ack?.ok) {
                onSuccess?.()
                return
            }

            try {
                const freshToken = await refreshAccessToken(userType)
                const retryAck = await emitJoin(freshToken)
                if (retryAck?.ok) onSuccess?.()
            } catch (err) {
                // Sessão realmente inválida — refreshAccessToken já desloga.
            }
        })
}
