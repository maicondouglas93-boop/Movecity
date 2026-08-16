import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import PassengerSafetyCenter from '@/passenger/components/PassengerSafetyCenter'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import api from '@/shared/services/axios'

vi.mock('@/shared/services/axios', () => ({
    default: {
        post: vi.fn().mockResolvedValue({ data: { ticket: {} } }),
        delete: vi.fn().mockResolvedValue({}),
    },
}))

const ride = {
    _id: '64f000000000000000000001',
    status: 'started',
    destination: 'Hospital Municipal, Centro',
    vehicleType: 'car',
    captain: {
        fullname: { firstname: 'Maria', lastname: 'Silva' },
        vehicle: { plate: 'ABC1D23', modelo: 'Onix', color: 'Prata' },
    },
}

describe('Central de segurança do passageiro', () => {
    beforeEach(() => vi.clearAllMocks())

    it('exibe a identificação e registra um problema vinculado à corrida', async () => {
        render(
            <ToastProvider>
                <PassengerSafetyCenter ride={ride} />
            </ToastProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /abrir central de segurança/i }))
        expect(screen.getByText('Maria Silva')).toBeInTheDocument()
        expect(screen.getByText('ABC1D23')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /reportar problema/i }))
        fireEvent.change(screen.getByLabelText('O que aconteceu?'), {
            target: { value: 'O motorista desviou da rota sem explicar.' },
        })
        fireEvent.click(screen.getByRole('button', { name: /enviar para o suporte/i }))

        await waitFor(() => expect(api.post).toHaveBeenCalledWith(
            '/support/tickets',
            expect.objectContaining({ rideId: ride._id, category: 'ride_issue' }),
            expect.any(Object)
        ))
    })

    it('exige confirmação antes de mostrar a ligação para o 190', () => {
        render(
            <ToastProvider>
                <PassengerSafetyCenter ride={ride} />
            </ToastProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /abrir central de segurança/i }))
        expect(screen.queryByRole('link', { name: /ligar 190/i })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /ligar para emergência/i }))
        expect(screen.getByRole('link', { name: /ligar 190/i })).toHaveAttribute('href', 'tel:190')
    })

    it('cria um link temporário para acompanhamento ao compartilhar', async () => {
        const share = vi.fn().mockResolvedValue()
        Object.defineProperty(navigator, 'share', { configurable: true, value: share })
        api.post.mockResolvedValueOnce({ data: { url: 'https://www.moovecity.com.br/track/token-seguro' } })

        render(
            <ToastProvider>
                <PassengerSafetyCenter ride={ride} />
            </ToastProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /abrir central de segurança/i }))
        fireEvent.click(screen.getByRole('button', { name: /compartilhar acompanhamento/i }))

        await waitFor(() => expect(api.post).toHaveBeenCalledWith(
            '/rides/share',
            { rideId: ride._id },
            expect.any(Object)
        ))
        await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://www.moovecity.com.br/track/token-seguro',
        })))
    })

    it('permite encerrar imediatamente o link compartilhado', async () => {
        const share = vi.fn().mockResolvedValue()
        Object.defineProperty(navigator, 'share', { configurable: true, value: share })
        api.post.mockResolvedValueOnce({ data: { url: 'https://www.moovecity.com.br/track/token-revogavel' } })

        render(
            <ToastProvider>
                <PassengerSafetyCenter ride={ride} />
            </ToastProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /abrir central de segurança/i }))
        fireEvent.click(screen.getByRole('button', { name: /compartilhar acompanhamento/i }))
        const revokeButton = await screen.findByRole('button', { name: /encerrar compartilhamento/i })
        fireEvent.click(revokeButton)

        await waitFor(() => expect(api.delete).toHaveBeenCalledWith(
            `/rides/share/${ride._id}`,
            expect.any(Object)
        ))
        await waitFor(() => expect(screen.queryByRole('button', { name: /encerrar compartilhamento/i })).not.toBeInTheDocument())
    })
})
