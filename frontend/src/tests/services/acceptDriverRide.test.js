import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
const pendingFinish = vi.hoisted(() => vi.fn())
vi.mock('@/shared/services/axios', () => ({ default: api }))
vi.mock('@/shared/services/offlineQueue', () => ({ hasPendingFinalization: pendingFinish }))
import { acceptDriverRide } from '@/driver/services/acceptDriverRide'

const offer = { _id: 'r1', status: 'requested' }
// DTO real do motorista omite `captain`; authCaptain isola a consulta no backend.
const assigned = { _id: 'r1', status: 'accepted', pickup: 'Rua A', destination: 'Rua B' }
const error = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } })
beforeEach(() => {
    vi.resetAllMocks()
    pendingFinish.mockResolvedValue(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    api.get.mockRejectedValue(error(404))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('aceite confirmado pelo servidor', () => {
    it('usa o endpoint atômico e aceita o DTO real sem inventar campos', async () => {
        api.post.mockResolvedValue({ data: assigned })
        await expect(acceptDriverRide(offer, 'c1')).resolves.toEqual(assigned)
        expect(api.post).toHaveBeenCalledWith('/rides/r1/accept', {})
        expect(api.get).not.toHaveBeenCalled()
    })
    it('não envia um novo aceite quando o aparelho já está offline', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        await expect(acceptDriverRide(offer, 'c1')).rejects.toThrow(/internet/)
        expect(api.post).not.toHaveBeenCalled()
    })
    it.each([409, 'ERR_NETWORK', 'CONNECTIVITY_TIMEOUT'])('recupera a própria atribuição após %s', async failure => {
        api.post.mockRejectedValue(failure === 409 ? error(409)
            : Object.assign(new Error(failure), { code: failure, isConnectivityIssue: failure === 'CONNECTIVITY_TIMEOUT' }))
        api.get.mockResolvedValue({ data: assigned })
        await expect(acceptDriverRide(offer, 'c1')).resolves.toEqual(assigned)
        expect(api.get).toHaveBeenCalledWith('/rides/captain-current')
        expect(api.post).toHaveBeenCalledTimes(1)
    })
    it('mantém resultado desconhecido quando o POST e a consulta falham', async () => {
        api.post.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
        api.get.mockRejectedValue(new Error('Network Error'))
        await expect(acceptDriverRide(offer, 'c1')).rejects.toMatchObject({ acceptanceUncertain: true })
    })
    it('não ressuscita uma viagem já encerrada no aparelho durante a reconciliação', async () => {
        api.post.mockRejectedValue(error(409))
        api.get.mockResolvedValue({ data: { ...assigned, status: 'started' } })
        pendingFinish.mockResolvedValue(true)
        await expect(acceptDriverRide(offer, 'c1')).rejects.toMatchObject({ finalizationPending: true })
        expect(pendingFinish).toHaveBeenCalledWith('r1', { throwOnError: true })
    })
    it('não confunde 404 de reconciliação com prova de que um POST atrasado foi cancelado', async () => {
        api.post.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
        await expect(acceptDriverRide(offer, 'c1')).rejects.toMatchObject({ acceptanceUncertain: true })
    })
    it('consulta antes de repetir e não reenvia quando já houve atribuição', async () => {
        api.get.mockResolvedValue({ data: assigned })
        await expect(acceptDriverRide(offer, 'c1', { reconcileFirst: true })).resolves.toEqual(assigned)
        expect(api.post).not.toHaveBeenCalled()
    })
    it('não repete POST se a consulta anterior à repetição falhar', async () => {
        api.get.mockRejectedValue(new Error('Network Error'))
        await expect(acceptDriverRide(offer, 'c1', { reconcileFirst: true })).rejects.toMatchObject({ acceptanceUncertain: true })
        expect(api.post).not.toHaveBeenCalled()
    })
    it('só repete o mesmo ID depois da consulta concluir sem corrida', async () => {
        const calls = []
        api.get.mockImplementation(async () => { calls.push('read'); return { data: null } })
        api.post.mockImplementation(async url => { calls.push(url); return { data: assigned } })
        await acceptDriverRide(offer, 'c1', { reconcileFirst: true })
        expect(calls).toEqual(['read', '/rides/r1/accept'])
    })
    it.each([null, {}, { ...assigned, _id: 'r2' }, { ...assigned, captain: 'other' }, offer])('não anuncia sucesso para resposta inválida (%j)', data => {
        api.post.mockResolvedValue({ data })
        return expect(acceptDriverRide(offer, 'c1')).rejects.toMatchObject({ acceptanceUncertain: true })
    })
    it.each([400, 401, 403, 404, 409])('preserva uma recusa HTTP %s, sem fabricar aceite', status => {
        api.post.mockRejectedValue(error(status))
        return expect(acceptDriverRide(offer, 'c1')).rejects.toMatchObject({ response: { status } })
    })
    it('limita HTTP nativo sem resposta e recupera a atribuição', async () => {
        vi.useFakeTimers()
        api.post.mockReturnValue(new Promise(() => {}))
        api.get.mockResolvedValue({ data: assigned })
        const request = acceptDriverRide(offer, 'c1')
        await vi.advanceTimersByTimeAsync(12000)
        await expect(request).resolves.toEqual(assigned)
    })
})
