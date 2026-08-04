import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import WaitingForDriver from '@/modules/passenger/components/WaitingForDriver';

// Correção crítica do cancelamento (2026-08-03): a regra de negócio sempre permitiu o
// passageiro cancelar com motorista já designado (accepted..waiting_passenger — ver
// VALID_ORIGINS_BY_TARGET.cancelled no backend), mas a tela do motorista/PIN não
// oferecia o botão. Estes testes fixam o comportamento: botão presente, confirmação em
// dois toques (há taxa possível) e chamada ao MESMO cancelRide da Home (endpoint real).

const baseRide = {
    _id: 'ride1',
    status: 'accepted',
    otp: '123456',
    fare: 25.5,
    paymentMethod: 'pix',
    pickup: 'Avenida Paulista, 1000',
    destination: 'Avenida Faria Lima, 2000',
    vehicleType: 'car',
    captain: {
        fullname: { firstname: 'João', lastname: 'Silva' },
        vehicle: { plate: 'ABC1234', color: 'Prata', vehicleType: 'car' },
    },
};

describe('WaitingForDriver — botão Cancelar corrida', () => {
    it('mostra o PIN e o botão de cancelar quando a corrida permite', () => {
        render(<WaitingForDriver ride={baseRide} cancelRide={vi.fn()} setWaitingForDriver={vi.fn()} />);

        expect(screen.getByText('123456')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancelar corrida/i })).toBeInTheDocument();
    });

    it('exige o segundo toque antes de cancelar (pode haver taxa) e só então chama cancelRide', async () => {
        const cancelRide = vi.fn().mockResolvedValue();
        render(<WaitingForDriver ride={baseRide} cancelRide={cancelRide} setWaitingForDriver={vi.fn()} />);

        const button = screen.getByRole('button', { name: /cancelar corrida/i });
        fireEvent.click(button);

        // Primeiro toque: nada foi cancelado ainda — vira confirmação com o aviso da taxa.
        expect(cancelRide).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /toque de novo para confirmar/i })).toBeInTheDocument();
        expect(screen.getByText(/taxa de cancelamento/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /toque de novo para confirmar/i }));
        expect(cancelRide).toHaveBeenCalledTimes(1);
    });
});
