import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import Activity from '@/passenger/pages/Activity';

// Bug: histórico do passageiro mostrava ride.fare (estimativa congelada na criação)
// em vez de ride.finalPrice (valor real recalculado no fim da corrida). Backend já
// persiste os dois campos corretamente — o problema era só o consumidor. Estes testes
// fixam a regra: corrida finalizada mostra SEMPRE finalPrice quando presente.

vi.mock('@/shared/services/axios', () => ({
    default: { get: vi.fn() },
}));

vi.mock('@/shared/services/session', () => ({
    getAccessToken: vi.fn(() => 'fake-token'),
}));

// Header não é o alvo do teste e arrasta PwaUpdateContext/ToastContext/NotificationInboxContext.
vi.mock('@/passenger/components/Header', () => ({
    default: () => <div data-testid="header-stub" />,
}));

import api from '@/shared/services/axios';

function mockHistoryResponse(rides) {
    api.get.mockResolvedValue({
        data: { rides, page: 1, limit: 10, total: rides.length, hasNext: false },
    });
}

function renderActivity() {
    return render(
        <MemoryRouter>
            <Activity />
        </MemoryRouter>,
    );
}

const baseRide = {
    _id: 'ride1',
    status: 'finished',
    vehicleType: 'car',
    pickup: 'Rua A, 1',
    destination: 'Rua B, 2',
    createdAt: new Date().toISOString(),
    paymentMethod: 'cash',
};

describe('Activity — histórico do passageiro mostra o valor final, não a estimativa', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Teste 1: estimativa == valor final -> mostra o mesmo valor', async () => {
        mockHistoryResponse([{ ...baseRide, fare: 44.74, finalPrice: 44.74 }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s44,74/)).toBeInTheDocument());
    });

    it('Teste 2: valor final MENOR que a estimativa -> mostra o valor final', async () => {
        mockHistoryResponse([{ ...baseRide, fare: 44.74, finalPrice: 38.2 }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s38,20/)).toBeInTheDocument());
        expect(screen.queryByText(/R\$\s44,74/)).not.toBeInTheDocument();
    });

    it('Teste 3: valor final MAIOR que a estimativa -> mostra o valor final', async () => {
        mockHistoryResponse([{ ...baseRide, fare: 44.74, finalPrice: 52.8 }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s52,80/)).toBeInTheDocument());
        expect(screen.queryByText(/R\$\s44,74/)).not.toBeInTheDocument();
    });

    it('Teste 4: corrida iniciada sem destino, destino definido ao finalizar -> mostra o valor final recalculado', async () => {
        // destinationPending descreve como a corrida começou; o que importa pro
        // histórico é que ela terminou com um finalPrice diferente da estimativa
        // congelada (destino original nem existia quando fare foi calculado).
        mockHistoryResponse([{
            ...baseRide,
            source: 'driver_initiated',
            destinationPending: true,
            fare: 0,
            finalPrice: 44.74,
        }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s44,74/)).toBeInTheDocument());
    });

    it('Teste 5: passageiro encerrou antes do destino estimado -> mostra o valor referente ao trajeto real', async () => {
        mockHistoryResponse([{ ...baseRide, fare: 60, finalPrice: 21.5 }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s21,50/)).toBeInTheDocument());
        expect(screen.queryByText(/R\$\s60,00/)).not.toBeInTheDocument();
    });

    it('Teste 6: reabrir o histórico (reload) -> continua mostrando o valor final persistido', async () => {
        mockHistoryResponse([{ ...baseRide, fare: 44.74, finalPrice: 38.2 }]);
        const { unmount } = renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s38,20/)).toBeInTheDocument());
        unmount();

        // "Reload": novo mount buscando o histórico de novo no backend.
        mockHistoryResponse([{ ...baseRide, fare: 44.74, finalPrice: 38.2 }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s38,20/)).toBeInTheDocument());
    });

    it('Teste 7: detalhe da corrida concluída mostra o valor final, não a estimativa', async () => {
        mockHistoryResponse([{ ...baseRide, fare: 44.74, finalPrice: 38.2 }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s38,20/)).toBeInTheDocument());

        fireEvent.click(screen.getByText('Rua B'));

        expect(await screen.findByText('Detalhes da Viagem')).toBeInTheDocument();
        // R$ 38.2 aparece duas vezes agora: no card da lista e no detalhe.
        expect(screen.getAllByText(/R\$\s38,20/)).toHaveLength(2);
        expect(screen.queryByText(/R\$\s44,74/)).not.toBeInTheDocument();
    });

    it('corrida ainda em andamento (sem finalPrice) mostra a estimativa', async () => {
        mockHistoryResponse([{ ...baseRide, status: 'started', fare: 44.74, finalPrice: undefined }]);
        renderActivity();
        await waitFor(() => expect(screen.getByText(/R\$\s44,74/)).toBeInTheDocument());
    });
});
