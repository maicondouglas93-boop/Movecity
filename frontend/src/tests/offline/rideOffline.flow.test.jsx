import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O app do motorista sem rede, ponta a ponta.
 *
 * Três bugs de campo em 16–17/ago tinham a MESMA causa e nenhum apareceu nos testes que
 * já existiam: o tratamento offline morava só no `catch`, e sem conectividade a
 * requisição não falha — o CapacitorHttp roteia todo HTTP pela camada nativa e ignora o
 * timeout do axios, então a promise fica pendurada. O botão girava pra sempre e a ação
 * nunca entrava na fila: fechar o app perdia a corrida já rodada.
 *
 * Por isso o mock central aqui devolve uma promise que NUNCA resolve. Um mock que
 * rejeita com 'Network Error' não teria pego nenhum dos três — o código sempre soube
 * tratar rejeição; o que ele não sabia tratar era silêncio.
 */

const state = vi.hoisted(() => ({
    enqueued: [],
    hangingCalls: 0,
    validationIssue: null,
    offlinePreview: {
        amount: 11.06,
        actualDistance: 100,
        elapsedSeconds: 120,
        offline: true,
        fareBreakdown: { baseFare: 6, distanceFare: 0.15, timeFare: 1.93 },
    },
}))

vi.mock('@/shared/services/axios', () => {
    // Nunca resolve nem rejeita — exatamente o que a camada nativa faz sem
    // conectividade. Declarado dentro do factory porque vi.mock é içado.
    const hangForever = () => {
        state.hangingCalls += 1
        return new Promise(() => {})
    }
    return { default: Object.assign(hangForever, { post: vi.fn(hangForever), get: vi.fn(hangForever) }) }
})

vi.mock('@/shared/services/offlineQueue', () => ({
    enqueueOfflineAction: vi.fn(async (action) => { state.enqueued.push(action) }),
    flushQueuedLocations: vi.fn(async () => ({ synced: 0 })),
    replayOfflineActions: vi.fn(async () => {}),
    actionLabel: (t) => t,
}))

vi.mock('@/shared/services/offlineRideFare', () => ({
    buildOfflineFinishPreview: vi.fn(async () => state.offlinePreview),
}))
vi.mock('@/shared/services/offlineFinishValidation', () => ({
    getOfflineFinishIssue: vi.fn(async () => state.validationIssue),
}))

vi.mock('@/shared/services/session', () => ({ getAccessToken: () => 'token' }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('@/shared/components/PassengerIdentityCard', () => ({ default: () => null }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return { ...actual, useNavigate: () => mockNavigate }
})

import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import FinishRide from '@/driver/components/FinishRide'
import api from '@/shared/services/axios'
import { flushQueuedLocations } from '@/shared/services/offlineQueue'
import { buildOfflineFinishPreview } from '@/shared/services/offlineRideFare'

const ride = {
    _id: 'ride-offline-1',
    status: 'started',
    fare: 16,
    paymentMethod: 'cash',
    pickup: 'Rua A, 100',
    destination: 'Av. Antônio Florêncio Alvim, Lajinha',
    user: { fullname: { firstname: 'Cliente' } },
}

function renderFinishRide({ syncCaptainRide = vi.fn(async () => null), currentRide = ride } = {}) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(
        <MemoryRouter>
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <SocketContext.Provider value={{ socket: { connected: false } }}>
                        <LocationContext.Provider value={{
                            userLocation: { lat: -20.15, lng: -41.62, accuracy: 10, timestamp: Date.now() },
                        }}>
                            <RideContext.Provider value={{
                                setCaptainRide: vi.fn(),
                                syncCaptainRide,
                            }}>
                                <FinishRide ride={currentRide} setRide={vi.fn()} />
                            </RideContext.Provider>
                        </LocationContext.Provider>
                    </SocketContext.Provider>
                </ToastProvider>
            </QueryClientProvider>
        </MemoryRouter>
    )
}

describe('app do motorista sem internet', () => {
    it.each(['carteira', 'card'])('não orienta cobrança externa para %s na finalização offline', async paymentMethod => {
        renderFinishRide({ currentRide: { ...ride, paymentMethod } })
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await user.click(await screen.findByRole('button', { name: /confirmar e finalizar/i }))
        await screen.findByRole('heading', { name: 'Finalização pendente' })
        expect(screen.queryByText(/para pagamento em dinheiro ou Pix/i)).toBeNull()
        expect(screen.getByText(/Não solicite dinheiro ou Pix diretamente/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /pagamento recebido/i })).toBeNull()
    })

    it.each(['cash', 'pix'])('liquidação de %s não afirma que o motorista recebeu dinheiro', async paymentMethod => {
        onLineSpy.mockReturnValue(true)
        api.post.mockResolvedValueOnce({ data: { ...ride, status: 'finished', paymentMethod,
            paymentStatus: 'paid', finalPrice: 20, collectionAmount: 15, driverAmount: 16 } })
        renderFinishRide({ currentRide: { ...ride, paymentMethod } })
        await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByRole('heading', { name: 'Serviço concluído' })
        expect(screen.queryByText('Pagamento confirmado')).toBeNull()
        expect(screen.getByText(/não comprova esse recebimento/i)).toBeInTheDocument()
        expect(screen.getByText(/R\$\s*15,00/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /voltar para o in.cio/i })).toBeInTheDocument()
    })
    it.each(['card', 'carteira'])('pagamento %s pendente não oferece confirmação de recebimento manual', async paymentMethod => {
        onLineSpy.mockReturnValue(true)
        api.post.mockResolvedValueOnce({ data: { ...ride, status: 'finished', paymentMethod,
            paymentStatus: 'pending', finalPrice: 20, driverAmount: 16 } })
        renderFinishRide({ currentRide: { ...ride, paymentMethod } })
        await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByRole('heading', { name: 'Serviço concluído' })
        expect(screen.queryByRole('button', { name: /pagamento recebido/i })).toBeNull()
        expect(screen.getByText(/Pagamento no aplicativo ainda pendente/)).toBeInTheDocument()
    })
    it('prévia indisponível não reaproveita finalPrice zero do snapshot antigo', async () => {
        state.offlinePreview = null
        renderFinishRide({ currentRide: { ...ride, finalPrice: 0 } })
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await user.click(await screen.findByRole('button', { name: /finalizar sem internet/i }))
        await screen.findByRole('heading', { name: 'Finalização pendente' })
        expect(screen.queryByText(/R\$\s*0,00/)).toBeNull()
        expect(screen.getByText(/Não cobre o passageiro até receber o valor final/)).toBeInTheDocument()
    })
    it.each([null, {}, { status: 'started' }, { ...ride, status: 'finished' }])('não finaliza dados ausentes ou corrida inativa (%j)', async currentRide => {
        renderFinishRide({ currentRide })
        expect(screen.getByRole('alert')).toHaveTextContent('Os dados da corrida não estão disponíveis')
        expect(screen.queryByRole('button', { name: /finalizar|confirmar/i })).toBeNull()
        expect(state.enqueued).toHaveLength(0)
        expect(state.hangingCalls).toBe(0)
    })
    let onLineSpy

    beforeEach(() => {
        state.enqueued.length = 0
        state.hangingCalls = 0
        state.validationIssue = null
        state.offlinePreview = {
            amount: 11.06,
            actualDistance: 100,
            elapsedSeconds: 120,
            offline: true,
            fareBreakdown: { baseFare: 6, distanceFare: 0.15, timeFare: 1.93 },
        }
        mockNavigate.mockClear()
        onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    })

    afterEach(() => {
        vi.useRealTimers()
        onLineSpy.mockRestore()
        vi.clearAllMocks()
    })

    it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'])('guarda a finalização após %s com o horário original', async (code) => {
        onLineSpy.mockReturnValue(true)
        let rejectRequest
        api.post.mockImplementationOnce(() => new Promise((_, reject) => { rejectRequest = reject }))
        renderFinishRide()
        await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await waitFor(() => expect(rejectRequest).toBeTypeOf('function'))
        const sent = api.post.mock.calls[0][1]
        const clock = vi.spyOn(Date, 'now').mockReturnValue(sent.finishTimestamp + 10000)
        try {
            await act(async () => rejectRequest(Object.assign(new Error('timeout of 10000ms exceeded'), { code })))
            await waitFor(() => expect(state.enqueued).toHaveLength(1))
            expect(state.enqueued[0].payload).toEqual(sent)
            expect(buildOfflineFinishPreview).toHaveBeenCalledWith(ride, sent.finishTimestamp)
        } finally {
            clock.mockRestore()
        }
    })

    it('preserva o toque quando a sincronização do GPS falha antes do POST', async () => {
        onLineSpy.mockReturnValue(true)
        let rejectGps
        flushQueuedLocations.mockImplementationOnce(() => new Promise((_, reject) => { rejectGps = reject }))
        const touch = 1788616800000
        const clock = vi.spyOn(Date, 'now').mockReturnValue(touch)
        try {
            renderFinishRide()
            await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
            await waitFor(() => expect(rejectGps).toBeTypeOf('function'))
            clock.mockReturnValue(touch + 8000)
            await act(async () => rejectGps(new Error('GPS sem conexão')))
            await waitFor(() => expect(state.enqueued).toHaveLength(1))
            expect(state.enqueued[0].payload.finishTimestamp).toBe(touch)
            expect(api.post).not.toHaveBeenCalled()
        } finally {
            clock.mockRestore()
        }
    })

    it('não transforma uma rejeição HTTP de regra em finalização offline', async () => {
        onLineSpy.mockReturnValue(true)
        api.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Localização inválida' } } })
        renderFinishRide()
        await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
        expect(await screen.findByText('Localização inválida')).toBeInTheDocument()
        expect(state.enqueued).toHaveLength(0)
    })

    it('guarda o horário original quando a camada nativa fica sem resposta por 12 segundos', async () => {
        vi.useFakeTimers()
        onLineSpy.mockReturnValue(true)
        renderFinishRide()
        fireEvent.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await act(async () => {})
        const sent = api.post.mock.calls[0][1]
        await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].payload).toEqual(sent)
    })

    it('guarda a finalização mesmo se a prévia local falhar depois do timeout', async () => {
        onLineSpy.mockReturnValue(true)
        api.post.mockRejectedValueOnce({ code: 'ECONNABORTED' })
        buildOfflineFinishPreview.mockRejectedValueOnce(new Error('Prévia indisponível'))
        renderFinishRide()
        await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
        expect(await screen.findByText(/aguarde o valor final antes de cobrar/i)).toBeInTheDocument()
        expect(state.enqueued).toHaveLength(1)
    })

    it('finalizar sem rede mostra o valor local em vez de travar', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))

        // A prévia sai do GPS guardado no celular, sem depender do servidor.
        expect(await screen.findByText(/R\$\s*11,06/)).toBeInTheDocument()
    })

    it('confirmar a finalização guarda na fila sem esperar a rede responder', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByText(/R\$\s*11,06/)
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))

        // O trabalho já executado precisa estar guardado — é isso que sobrevive a
        // fechar o app. Sem timeout generoso: tem que ser imediato, não em 12s.
        await waitFor(() => {
            expect(state.enqueued.map((a) => a.type)).toContain('end-ride')
        })
        expect(state.hangingCalls).toBe(0)
    })

    // Finalizar tem que resolver tudo: comissão e repasse liquidam dentro do próprio
    // end-ride, e dinheiro/Pix vão direto pra mão do motorista. Offline, a tela ainda
    // exigia um toque em "Pagamento Recebido" que não decidia mais nada — cerimônia com
    // a corrida já encerrada e o dinheiro já no bolso.
    it('finalizar sem rede encerra o serviço sem pedir confirmação de pagamento', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByText(/R\$\s*11,06/)
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))

        // Guardada não significa confirmada. Não prometer liquidação offline.
        expect(await screen.findByRole('heading', { name: 'Finalização pendente' })).toBeInTheDocument()
        expect(screen.queryByText(/já está encerrada|confirma sozinha|cobre o cliente agora/i)).toBeNull()
        expect(screen.queryByRole('button', { name: /pagamento recebido/i })).toBeNull()
        expect(screen.getByRole('button', { name: /voltar para o in.cio/i })).toBeInTheDocument()
    })

    // O "Pagamento recebido" offline deixou de existir (a comissão liquida na própria
    // finalização e o dinheiro vai direto pra mão do motorista). O que estes testes
    // protegiam continua valendo, só que agora com UMA ação: nada pode pendurar a rede
    // sabendo que está offline, e a finalização tem que ficar guardada.
    it('nenhuma ação offline chega a tocar a rede', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByText(/R\$\s*11,06/)
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))
        await waitFor(() => expect(state.enqueued.length).toBeGreaterThan(0))

        // Sabendo que está offline, o app não deve nem tentar — tentar é o que produzia
        // a promise pendurada que nunca voltava.
        expect(state.hangingCalls).toBe(0)
    })

    it('guarda só a finalização, sem ação de pagamento redundante', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByText(/R\$\s*11,06/)
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))

        await waitFor(() => {
            expect(state.enqueued.map((a) => a.type)).toEqual(['end-ride'])
        })
        expect(state.enqueued.every((a) => a.rideId === ride._id)).toBe(true)
    })

    it('teste parado não mostra cobrança, não enfileira e mantém a corrida aberta', async () => {
        state.validationIssue = { message: 'Distância insuficiente para finalizar. A corrida não foi encerrada.' }
        renderFinishRide()
        await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Distância insuficiente')
        expect(screen.queryByRole('button', { name: /confirmar e finalizar/i })).toBeNull()
        expect(state.enqueued).toHaveLength(0)
        expect(state.hangingCalls).toBe(0)
    })

    it('revalida ao confirmar e não usa uma prévia antiga para ignorar a trava', async () => {
        renderFinishRide()
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByRole('button', { name: /confirmar e finalizar/i })
        state.validationIssue = { message: 'Localização desatualizada. A corrida não foi encerrada.' }
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Localização desatualizada')
        expect(state.enqueued).toHaveLength(0)
        expect(screen.queryByRole('heading', { name: 'Finalização pendente' })).toBeNull()
    })

    it('timeout online também respeita a rejeição da validação offline', async () => {
        onLineSpy.mockReturnValue(true)
        api.post.mockRejectedValueOnce({ code: 'ECONNABORTED' })
        state.validationIssue = { message: 'Distância insuficiente para finalizar.' }
        renderFinishRide()
        await userEvent.setup().click(screen.getByRole('button', { name: /finalizar corrida/i }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Distância insuficiente')
        expect(state.enqueued).toHaveLength(0)
    })

    it('permite finalizar offline mesmo quando o celular não consegue calcular o valor', async () => {
        state.offlinePreview = null
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))

        expect(await screen.findByText(/não cobre o passageiro/i)).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: /finalizar sem internet/i }))

        await waitFor(() => expect(state.enqueued.map(action => action.type)).toEqual(['end-ride']))
        expect(await screen.findByRole('button', { name: /voltar para o in.cio/i })).toBeInTheDocument()
    })

    it('sai da prévia pendurada e oferece finalização offline quando a rede mente que está online', async () => {
        vi.useFakeTimers()
        onLineSpy.mockReturnValue(true)
        state.offlinePreview = null
        renderFinishRide({ syncCaptainRide: () => new Promise(() => {}) })

        fireEvent.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000)
        })

        expect(screen.getByText(/não cobre o passageiro/i)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /finalizar sem internet/i }))
        await act(async () => {})

        expect(state.enqueued.map(action => action.type)).toEqual(['end-ride'])
    })
})
