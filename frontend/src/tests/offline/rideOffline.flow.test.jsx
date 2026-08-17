import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
}))

vi.mock('@/shared/services/axios', () => {
    // Nunca resolve nem rejeita — exatamente o que a camada nativa faz sem
    // conectividade. Declarado dentro do factory porque vi.mock é içado.
    const hangForever = () => {
        state.hangingCalls += 1
        return new Promise(() => {})
    }
    return { default: Object.assign(hangForever, { post: hangForever, get: hangForever }) }
})

vi.mock('@/shared/services/offlineQueue', () => ({
    enqueueOfflineAction: vi.fn(async (action) => { state.enqueued.push(action) }),
    flushQueuedLocations: vi.fn(async () => ({ synced: 0 })),
    replayOfflineActions: vi.fn(async () => {}),
    actionLabel: (t) => t,
}))

vi.mock('@/shared/services/offlineRideFare', () => ({
    buildOfflineFinishPreview: vi.fn(async () => ({
        amount: 11.06,
        actualDistance: 100,
        elapsedSeconds: 120,
        offline: true,
        fareBreakdown: { baseFare: 6, distanceFare: 0.15, timeFare: 1.93 },
    })),
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

const ride = {
    _id: 'ride-offline-1',
    status: 'started',
    fare: 16,
    paymentMethod: 'cash',
    pickup: 'Rua A, 100',
    destination: 'Av. Antônio Florêncio Alvim, Lajinha',
    user: { fullname: { firstname: 'Cliente' } },
}

function renderFinishRide() {
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
                                syncCaptainRide: vi.fn(async () => null),
                            }}>
                                <FinishRide ride={ride} setRide={vi.fn()} />
                            </RideContext.Provider>
                        </LocationContext.Provider>
                    </SocketContext.Provider>
                </ToastProvider>
            </QueryClientProvider>
        </MemoryRouter>
    )
}

describe('app do motorista sem internet', () => {
    let onLineSpy

    beforeEach(() => {
        state.enqueued.length = 0
        state.hangingCalls = 0
        mockNavigate.mockClear()
        onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    })

    afterEach(() => {
        onLineSpy.mockRestore()
        vi.clearAllMocks()
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

    // Regressão do relato de campo (17/ago): a finalização já funcionava offline, mas
    // "Pagamento recebido" ficava girando pra sempre — o gêmeo que não tinha sido
    // corrigido junto.
    it('confirmar pagamento sem rede não trava o botão', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByText(/R\$\s*11,06/)
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))

        const cobrar = await screen.findByRole('button', { name: /pagamento recebido/i })
        await user.click(cobrar)

        await waitFor(() => {
            expect(state.enqueued.map((a) => a.type)).toContain('confirm-payment')
        })
        expect(state.hangingCalls).toBe(0)
    })

    it('nenhuma ação offline chega a tocar a rede', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByText(/R\$\s*11,06/)
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))
        await waitFor(() => expect(state.enqueued.length).toBeGreaterThan(0))

        const cobrar = await screen.findByRole('button', { name: /pagamento recebido/i })
        await user.click(cobrar)
        await waitFor(() => expect(state.enqueued.length).toBe(2))

        // Sabendo que está offline, o app não deve nem tentar — tentar é o que produzia
        // a promise pendurada que nunca voltava.
        expect(state.hangingCalls).toBe(0)
    })

    it('o ciclo inteiro guarda finalização e pagamento, nessa ordem', async () => {
        const user = userEvent.setup()
        renderFinishRide()

        await user.click(screen.getByRole('button', { name: /finalizar corrida/i }))
        await screen.findByText(/R\$\s*11,06/)
        await user.click(screen.getByRole('button', { name: /confirmar e finalizar/i }))
        await waitFor(() => expect(state.enqueued.length).toBeGreaterThan(0))

        const cobrar = await screen.findByRole('button', { name: /pagamento recebido/i })
        await user.click(cobrar)

        await waitFor(() => {
            expect(state.enqueued.map((a) => a.type)).toEqual(['end-ride', 'confirm-payment'])
        })
        // A ordem importa: o replay é sequencial e a finalização precisa chegar antes
        // do pagamento, senão o servidor recusa a confirmação de uma corrida não
        // finalizada.
        expect(state.enqueued.every((a) => a.rideId === ride._id)).toBe(true)
    })
})
