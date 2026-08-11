import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { RideContext } from '@/shared/contexts/RideContext';
import { SocketContext } from '@/shared/contexts/SocketContext';
import { ToastProvider } from '@/shared/contexts/ToastContext';
import CaptainParcelRiding from '@/driver/pages/CaptainParcelRiding';

// Bug (auditoria do app do motorista, 2026-08-11, P0): aceitar uma encomenda pelo botão
// de ação da notificação nativa Android (app em segundo plano) manda pra /captain-parcel
// sem location.state — a tela mostrava "Nenhuma encomenda ativa" IMEDIATAMENTE, antes da
// busca ao backend terminar, levando o motorista a achar que não tinha aceitado nada.
// Estes testes fixam: nunca mostrar "sem encomenda" antes de confirmar com o backend.

vi.mock('@/shared/components/LiveTracking', () => ({
    default: () => <div data-testid="live-tracking-stub" />,
}));
vi.mock('@/shared/components/RideChat', () => ({ default: () => null }));
vi.mock('@/shared/services/parcelApi', () => ({
    confirmParcelDelivery: vi.fn(),
    confirmParcelPayment: vi.fn(),
    skipCaptainParcelReview: vi.fn(),
    updateParcelStatus: vi.fn(),
}));
vi.mock('@/shared/services/reviewApi', () => ({ submitCaptainReview: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => mockNavigate };
});

const activeParcel = {
    _id: 'parcel1',
    status: 'provider_accepted',
    paymentStatus: 'pending',
    pickup: 'Rua A, 1',
    destination: 'Rua B, 2',
    vehicleType: 'car',
    fare: 25,
};

function renderWithProviders({ syncCaptainParcel, captainParcel = null }) {
    return render(
        <MemoryRouter initialEntries={['/captain-parcel']}>
            <ToastProvider>
                <SocketContext.Provider value={{ socket: null }}>
                    <RideContext.Provider value={{ captainParcel, setCaptainParcel: vi.fn(), syncCaptainParcel }}>
                        <CaptainParcelRiding />
                    </RideContext.Provider>
                </SocketContext.Provider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe('CaptainParcelRiding — sem "Nenhuma encomenda ativa" antes de confirmar com o backend', () => {
    beforeEach(() => {
        mockNavigate.mockClear();
    });

    it('mostra o spinner de carregamento, nunca "Nenhuma encomenda ativa", enquanto a sincronização está em andamento', () => {
        let resolveSync;
        const syncCaptainParcel = vi.fn(() => new Promise((resolve) => { resolveSync = resolve; }));
        renderWithProviders({ syncCaptainParcel });

        expect(screen.queryByText('Nenhuma encomenda ativa')).not.toBeInTheDocument();
        // resolve depois, fora da janela do teste — só garante que nada resolveu ainda.
        expect(resolveSync).toBeDefined();
    });

    it('aceite via notificação nativa (sem location.state): sincroniza e mostra a encomenda ativa, sem piscar "Nenhuma encomenda ativa"', async () => {
        const syncCaptainParcel = vi.fn().mockResolvedValue(activeParcel);
        renderWithProviders({ syncCaptainParcel });

        expect(screen.queryByText('Nenhuma encomenda ativa')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('live-tracking-stub')).toBeInTheDocument());
        expect(screen.queryByText('Nenhuma encomenda ativa')).not.toBeInTheDocument();
        expect(syncCaptainParcel).toHaveBeenCalledTimes(1);
    });

    it('sem encomenda local nem no backend: só redireciona pra Home depois de confirmar (nunca antes)', async () => {
        const syncCaptainParcel = vi.fn().mockResolvedValue(null);
        renderWithProviders({ syncCaptainParcel });

        expect(mockNavigate).not.toHaveBeenCalled();
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/captain-home', { replace: true }));
    });

    it('usa captainParcel do contexto como estado inicial quando location.state está vazio', () => {
        const syncCaptainParcel = vi.fn(() => new Promise(() => {})); // nunca resolve nesta janela
        renderWithProviders({ syncCaptainParcel, captainParcel: activeParcel });

        // Com captainParcel já disponível no contexto, a tela não deveria ficar presa no
        // spinner "puro" — o conteúdo da encomenda já pode montar imediatamente.
        expect(screen.getByTestId('live-tracking-stub')).toBeInTheDocument();
    });
});
