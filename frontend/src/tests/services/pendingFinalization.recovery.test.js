import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/shared/services/db'
const state = vi.hoisted(() => ({ owner: 'c1' }))
const api = vi.hoisted(() => vi.fn())
vi.mock('@/shared/services/axios', () => ({ default: api }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => 'token', getSessionOwnerId: () => state.owner }))
import { replayOfflineActions, retryPendingFinalization } from '@/shared/services/offlineQueue'
import { pendingSupportMessage } from '@/shared/utils/pendingFinalization'

async function pending(extra = {}) {
    return db.offlineActions.add({ type: 'end-ride', rideId: 'r1', ownerId: 'c1', timestamp: 3000, attempts: 0,
        payload: { rideId: 'r1', finishTimestamp: 2000, finishLat: -20, finishLng: -41, finishAccuracy: 10 }, ...extra })
}
beforeEach(async () => {
    await db.delete(); await db.open()
    api.mockReset(); state.owner = 'c1'
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    api.mockResolvedValue({ data: { _id: 'r1', status: 'finished' } })
})
afterEach(async () => { vi.restoreAllMocks(); await db.delete() })

describe('recuperação de uma finalização específica', () => {
    it('reenvia o pedido original e não toca outra corrida nem pagamento', async () => {
        const other = await pending({ rideId: 'other', timestamp: 1000, payload: { rideId: 'other', finishTimestamp: 500 } })
        const id = await pending()
        const saved = await db.offlineActions.get(id)
        await expect(retryPendingFinalization(id)).resolves.toEqual({ status: 'resolved' })
        expect(api).toHaveBeenCalledTimes(1)
        expect(api.mock.calls[0][0].data).toMatchObject(saved.payload)
        expect(await db.offlineActions.get(other)).toBeDefined()
        expect(await db.offlineActions.get(id)).toBeUndefined()
    })
    it('duas tentativas e o replay automático compartilham a fila, sem POST duplicado', async () => {
        const id = await pending()
        await Promise.all([retryPendingFinalization(id), replayOfflineActions(), retryPendingFinalization(id)])
        expect(api).toHaveBeenCalledTimes(1)
        expect(await db.offlineActions.count()).toBe(0)
    })
    it('sincroniza o início anterior da mesma corrida antes da finalização', async () => {
        await db.offlineActions.add({ type: 'start-ride', rideId: 'r1', ownerId: 'c1', timestamp: 1000,
            payload: { rideId: 'r1', occurredAt: 700 } })
        const id = await pending()
        await retryPendingFinalization(id)
        expect(api.mock.calls[0][0].url).toMatch(/start-ride$/)
        expect(api.mock.calls[0][0].params.occurredAt).toBe(700)
        expect(api.mock.calls[1][0].url).toMatch(/end-ride$/)
    })
    it.each([{ payload: { rideId: 'other' } }, { ownerId: null }])('não reenvia pré-requisito incoerente ou sem dono (%j)', async extra => {
        await db.offlineActions.add({ type: 'start-ride', rideId: 'r1', ownerId: 'c1', timestamp: 1000,
            payload: { rideId: 'r1', occurredAt: 700 }, ...extra })
        const id = await pending()
        await expect(retryPendingFinalization(id)).rejects.toThrow(/etapas anteriores/)
        expect(api).not.toHaveBeenCalled()
        expect(await db.offlineActions.count()).toBe(2)
    })
    it.each([400, 401, 403, 404, 409, 503])('preserva o trabalho e registra a resposta HTTP %s', async status => {
        const id = await pending()
        api.mockRejectedValue({ response: { status, data: { message: 'Resposta de teste' } } })
        await expect(retryPendingFinalization(id)).resolves.toEqual({ status: 'pending' })
        expect(await db.offlineActions.get(id)).toMatchObject({ attempts: 1, lastHttpStatus: status,
            lastError: 'Resposta de teste', lastAttemptAt: expect.any(Number), payload: { finishTimestamp: 2000 } })
        if ([403, 404].includes(status)) {
            await replayOfflineActions()
            expect(api).toHaveBeenCalledTimes(1)
            await expect(retryPendingFinalization(id)).rejects.toThrow(/suporte/)
        }
    })
    it.each([{}, { _id: 'other', status: 'finished' }, { _id: 'r1', status: 'started' }])('não apaga por ACK incoerente (%j)', async data => {
        const id = await pending()
        api.mockResolvedValue({ data })
        expect(await retryPendingFinalization(id)).toEqual({ status: 'pending' })
        expect(await db.offlineActions.get(id)).toBeDefined()
    })
    it('não envia finalização antes de sincronizar os pontos GPS', async () => {
        const id = await pending()
        await db.driverLocations.add({ pointId: 'p1', rideId: 'r1', lat: -20, lng: -41, capturedAt: 1500 })
        await expect(retryPendingFinalization(id, { socket: { connected: false } })).resolves.toEqual({ status: 'pending' })
        expect(api).not.toHaveBeenCalled()
        expect(await db.driverLocations.count()).toBe(1)
        expect((await db.offlineActions.get(id)).lastError).toMatch(/GPS/)
    })
    it.each([{ ownerId: 'other' }, { ownerId: null }, { rideId: null }, { payload: { rideId: 'other' } },
        { apiBase: 'https://other.example' }])('não envia registro sem vínculo seguro (%j)', async extra => {
        const id = await pending(extra)
        await expect(retryPendingFinalization(id)).rejects.toThrow(/suporte/)
        expect(api).not.toHaveBeenCalled()
        expect(await db.offlineActions.get(id)).toBeDefined()
    })
    it('não apaga nem anuncia confirmação depois de trocar de conta', async () => {
        const id = await pending()
        api.mockImplementation(async () => { state.owner = 'c2'; return { data: { _id: 'r1', status: 'finished' } } })
        await expect(retryPendingFinalization(id)).rejects.toThrow(/conta mudou/)
        expect(await db.offlineActions.get(id)).toBeDefined()
    })
    it('sem internet mantém o registro e não chama a API', async () => {
        const id = await pending()
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        await expect(retryPendingFinalization(id)).rejects.toThrow(/internet/)
        expect(api).not.toHaveBeenCalled()
        expect(await db.offlineActions.get(id)).toBeDefined()
    })
    it('resumo do suporte contém referência, mas não dados pessoais ou mensagem bruta', () => {
        const message = pendingSupportMessage({ id: 9, rideId: 'r1', payload: { finishTimestamp: 2000, finishLat: -20 },
            rideSnapshot: { pickup: 'Endereço privado', user: { name: 'Pessoa privada' } }, lastError: 'Bearer SECRET' })
        expect(message).toContain('Local 9 · Corrida r1')
        expect(message).not.toMatch(/Endereço privado|Pessoa privada|SECRET|finishLat/)
    })
})
