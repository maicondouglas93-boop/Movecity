import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import RideDrawer from '../../src/components/rides/RideDrawer';
import api from '../../src/services/api';

vi.mock('../../src/services/api', () => ({
  default: { get: vi.fn() },
}));

it('permite recuperar o PIN de uma corrida ativa lançada pelo painel', async () => {
  api.get.mockImplementation(async (url) => {
    if (url.endsWith('/timeline')) return { data: [] };
    if (url.endsWith('/access-code')) return { data: { otp: '482913' } };
    throw new Error(`GET inesperado: ${url}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ride = {
    _id: 'ride-1',
    source: 'admin',
    serviceType: 'ride',
    status: 'requested',
    updatedAt: new Date().toISOString(),
    pickup: 'Rua A, 10',
    destination: 'Rua B, 20',
    fare: 18.5,
    paymentMethod: 'cash',
    adminPassenger: { name: 'Maria Silva', phone: '+5533999990000', passengerCount: 1 },
    statusHistory: [],
  };

  render(
    <QueryClientProvider client={queryClient}>
      <RideDrawer ride={ride} onClose={vi.fn()} onAction={vi.fn()} />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Exibir PIN de início' }));

  expect(await screen.findByText('482913')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/admin/rides/ride-1/access-code');
});
