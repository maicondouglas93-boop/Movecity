import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CaptainDataContext } from '@/driver/contexts/CaptainContext';
import CaptainEarnings from '@/driver/pages/CaptainEarnings';

// Bug (auditoria do app do motorista, 2026-08-11, P1): "Ganhos Totais" mostrava
// captain.earnings (bruto, sem descontar comissão) — nunca batia com a soma dos
// cards de período (líquidos) logo abaixo, na mesma tela.

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }));
vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'fake-token') }));
vi.mock('@/driver/components/CaptainHeader', () => ({ default: () => <div data-testid="header-stub" /> }));

import api from '@/shared/services/axios';

function renderEarnings(captain) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <CaptainDataContext.Provider value={{ captain }}>
                    <CaptainEarnings />
                </CaptainDataContext.Provider>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('CaptainEarnings — Ganhos Totais usa o mesmo cálculo líquido dos períodos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('mostra o total líquido (range=all), não o captain.earnings bruto', async () => {
        api.get.mockImplementation((url) => {
            if (url.includes('range=all')) {
                return Promise.resolve({ data: { totalEarnings: 46.56, totalRides: 2, rides: [] } });
            }
            return Promise.resolve({ data: { totalEarnings: 10, totalRides: 1, rides: [] } });
        });

        renderEarnings({ earnings: 999.99, rating: 4.8, totalRides: 2 });

        await waitFor(() => expect(screen.getByText('R$ 46.56')).toBeInTheDocument());
        expect(screen.queryByText('R$ 999.99')).not.toBeInTheDocument();
    });

    it('motorista sem avaliação nenhuma mostra "—", não "5.0" fixo', async () => {
        api.get.mockResolvedValue({ data: { totalEarnings: 0, totalRides: 0, rides: [] } });

        renderEarnings({ earnings: 0, rating: undefined, totalRides: 0 });

        expect(await screen.findByText('—')).toBeInTheDocument();
        expect(screen.queryByText('5.0')).not.toBeInTheDocument();
        expect(screen.getByText('Sem avaliações ainda')).toBeInTheDocument();
    });
});
