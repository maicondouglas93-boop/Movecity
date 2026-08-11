import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import ManualRideModal from '../../src/components/rides/ManualRideModal';
import api from '../../src/services/api';

vi.mock('../../src/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../src/components/AdminAddressAutocomplete', () => ({
  default: ({ id, label, value, onChange, onResolved }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      <button
        type="button"
        onClick={() => onResolved(
          `${label}, Lajinha - MG`,
          label.includes('partida') ? { lat: -20.15, lng: -41.62 } : { lat: -20.16, lng: -41.61 },
        )}
      >
        Confirmar {label}
      </button>
    </div>
  ),
}));

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ManualRideModal onClose={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function fillValidRide() {
  fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Maria Silva' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDD'), { target: { value: '(33) 99999-0000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar Endereço de partida' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar Endereço de destino' }));
  await waitFor(() => expect(screen.getByLabelText('Categoria do veículo')).toHaveValue('car'));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/rides/manual/available-captains', expect.any(Object)));
  fireEvent.click(screen.getByRole('button', { name: 'Calcular estimativa' }));
  await screen.findByText(/18,50/);
  expect(api.post).toHaveBeenCalledWith('/admin/rides/manual/estimate', expect.objectContaining({
    pickup: 'Endereço de partida, Lajinha - MG',
    pickupCoordinates: { lat: -20.15, lng: -41.62 },
    destinationCoordinates: { lat: -20.16, lng: -41.61 },
  }));
}

describe('Lançamento manual de corrida', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation(async (url) => {
      if (url === '/admin/vehicle-categories') {
        return { data: { categories: [{ _id: 'cat-1', name: 'car', displayName: 'Carro', capacity: 4, isActive: true, allowedServices: { ride: true } }] } };
      }
      if (url === '/admin/captains') return { data: { captains: [] } };
      if (url === '/admin/users') return { data: { users: [] } };
      throw new Error(`GET inesperado: ${url}`);
    });
  });

  it('exige endereço resolvido novamente quando o texto da partida é alterado', async () => {
    api.post.mockImplementation(async (url) => {
      if (url === '/admin/rides/manual/available-captains') return { data: { captains: [] } };
      if (url === '/admin/rides/manual/estimate') return { data: { distance: 6200, time: 900, fare: 18.5 } };
      throw new Error(`POST inesperado: ${url}`);
    });

    renderModal();
    await fillValidRide();

    const launch = screen.getByRole('button', { name: 'LANÇAR CORRIDA' });
    expect(launch).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Endereço de partida'), { target: { value: 'Outro endereço digitado' } });

    expect(launch).toBeDisabled();
    expect(screen.getByText('Escolha uma sugestão da lista para confirmar o ponto exato')).toBeInTheDocument();
  });

  it('reutiliza a mesma chave idempotente no retry e mostra o PIN devolvido pelo backend', async () => {
    const manualBodies = [];
    api.post.mockImplementation(async (url, body) => {
      if (url === '/admin/rides/manual/available-captains') return { data: { captains: [] } };
      if (url === '/admin/rides/manual/estimate') return { data: { distance: 6200, time: 900, fare: 18.5 } };
      if (url === '/admin/rides/manual') {
        manualBodies.push(body);
        if (manualBodies.length === 1) {
          throw { response: { data: { message: 'Tempo esgotado. Tente novamente.' } } };
        }
        return { data: { _id: 'ride-1', otp: '482913', manualDispatch: { mode: 'automatic', offeredCount: 1 } } };
      }
      throw new Error(`POST inesperado: ${url}`);
    });

    renderModal();
    await fillValidRide();

    fireEvent.click(screen.getByRole('button', { name: 'LANÇAR CORRIDA' }));
    await screen.findByText('Tempo esgotado. Tente novamente.');
    fireEvent.click(screen.getByRole('button', { name: 'LANÇAR CORRIDA' }));

    await screen.findByText('482913');
    expect(manualBodies).toHaveLength(2);
    expect(manualBodies[0].idempotencyKey).toBe(manualBodies[1].idempotencyKey);
    expect(screen.queryByRole('option', { name: 'Cartão' })).not.toBeInTheDocument();
  });
});
