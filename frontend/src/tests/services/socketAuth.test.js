import { describe, it, expect, vi, beforeEach } from 'vitest'

// Auditoria de regressão de push (2026-08-03,
// docs/plans/2026-08-03-auditoria-regressao-push.md): o join do Socket.IO passou a
// exigir JWT válido (C1/C2 da auditoria PWA), mas nada renovava o token antes de
// reemitir join numa reconexão — um motorista com o token vencido caía fora do
// despacho de corridas silenciosamente. joinWithRetry fecha essa lacuna: se o join
// falhar, renova o token e tenta mais uma vez antes de desistir.

const getAccessTokenMock = vi.fn()
const refreshAccessTokenMock = vi.fn()

vi.mock('@/services/session', () => ({
    getAccessToken: (...args) => getAccessTokenMock(...args),
}))
vi.mock('@/services/axios', () => ({
    refreshAccessToken: (...args) => refreshAccessTokenMock(...args),
}))

const { joinWithRetry } = await import('@/services/socketAuth')

const makeSocket = (acks) => {
    let call = 0
    return {
        emit: vi.fn((event, payload, callback) => {
            const ack = acks[call] ?? acks[acks.length - 1]
            call += 1
            callback(ack)
        }),
    }
}

describe('joinWithRetry', () => {
    beforeEach(() => {
        getAccessTokenMock.mockReset().mockReturnValue('token-atual')
        refreshAccessTokenMock.mockReset()
    })

    it('join bem-sucedido de primeira: não tenta renovar token, chama onSuccess', async () => {
        const socket = makeSocket([{ ok: true }])
        const onSuccess = vi.fn()

        joinWithRetry(socket, { userId: 'u1', userType: 'user' }, onSuccess)
        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled())

        expect(socket.emit).toHaveBeenCalledTimes(1)
        expect(socket.emit).toHaveBeenCalledWith(
            'join',
            { userId: 'u1', userType: 'user', token: 'token-atual' },
            expect.any(Function)
        )
        expect(refreshAccessTokenMock).not.toHaveBeenCalled()
    })

    it('join rejeitado (token vencido): renova o token e tenta de novo — cenário real da regressão', async () => {
        const socket = makeSocket([{ ok: false, message: 'Token inválido' }, { ok: true }])
        refreshAccessTokenMock.mockResolvedValue('token-novo')
        const onSuccess = vi.fn()

        joinWithRetry(socket, { userId: 'c1', userType: 'captain' }, onSuccess)
        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled())

        expect(refreshAccessTokenMock).toHaveBeenCalledWith('captain')
        expect(socket.emit).toHaveBeenCalledTimes(2)
        // Segunda tentativa usa o token renovado, não o antigo.
        expect(socket.emit).toHaveBeenNthCalledWith(
            2,
            'join',
            { userId: 'c1', userType: 'captain', token: 'token-novo' },
            expect.any(Function)
        )
    })

    it('join rejeitado E renovação falha (sessão morta de verdade): desiste sem quebrar, não chama onSuccess', async () => {
        const socket = makeSocket([{ ok: false, message: 'Token inválido' }])
        refreshAccessTokenMock.mockRejectedValue(new Error('refresh token expirado'))
        const onSuccess = vi.fn()

        joinWithRetry(socket, { userId: 'c1', userType: 'captain' }, onSuccess)
        await vi.waitFor(() => expect(refreshAccessTokenMock).toHaveBeenCalled())
        // Só uma tentativa de emit — não insiste indefinidamente.
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(socket.emit).toHaveBeenCalledTimes(1)
        expect(onSuccess).not.toHaveBeenCalled()
    })
})
