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
    const portalRoot = document.createElement('div');
    portalRoot.id = 'admin-modal-root';
    document.body.appendChild(portalRoot);
    api.get.mockImplementation(async (url) => {
      if (url === '/admin/vehicle-categories') {
        return { data: { categories: [{ _id: 'cat-1', name: 'car', displayName: 'Carro', capacity: 4, isActive: true, allowedServices: { ride: true } }] } };
      }
      if (url === '/admin/captains') return { data: { captains: [] } };
      if (url === '/admin/users') return { data: { users: [] } };
      if (/\/admin\/rides\/[^/]+\/manual-dispatch$/.test(url)) {
        return { data: { status: 'requested', captainId: null, canRelaunch: false, offerExpiresAt: new Date(Date.now() + 45_000).toISOString() } };
      }
      throw new Error(`GET inesperado: ${url}`);
    });
  });

  afterEach(() => {
    document.getElementById('admin-modal-root')?.remove();
  });

  it('renderiza no contêiner exclusivo do modal', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: 'Lançar corrida' }).parentElement)
      .toHaveAttribute('id', 'admin-modal-root');
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

  it('permite lançar novamente a mesma corrida depois que a oferta expira', async () => {
    const expiredAt = new Date(Date.now() - 1_000).toISOString();
    api.get.mockImplementation(async (url) => {
      if (url === '/admin/vehicle-categories') {
        return { data: { categories: [{ _id: 'cat-1', name: 'car', displayName: 'Carro', capacity: 4, isActive: true, allowedServices: { ride: true } }] } };
      }
      if (url === '/admin/captains') return { data: { captains: [] } };
      if (url === '/admin/users') return { data: { users: [] } };
      if (url === '/admin/rides/ride-1/manual-dispatch') {
        return { data: { status: 'requested', captainId: null, canRelaunch: true, offerExpiresAt: expiredAt } };
      }
      throw new Error(`GET inesperado: ${url}`);
    });
    api.post.mockImplementation(async (url) => {
      if (url === '/admin/rides/manual/available-captains') return { data: { captains: [] } };
      if (url === '/admin/rides/manual/estimate') return { data: { distance: 6200, time: 900, fare: 18.5 } };
      if (url === '/admin/rides/manual') {
        return {
          data: {
            _id: 'ride-1',
            status: 'requested',
            otp: '482913',
            offerExpiresAt: expiredAt,
            manualDispatch: { status: 'requested', captainId: null, canRelaunch: true, offerExpiresAt: expiredAt, offeredCount: 1 },
          },
        };
      }
      if (url === '/admin/rides/ride-1/relaunch') {
        return {
          data: {
            _id: 'ride-1',
            status: 'requested',
            otp: '482913',
            manualDispatch: {
              status: 'requested',
              captainId: null,
              canRelaunch: false,
              offerExpiresAt: new Date(Date.now() + 45_000).toISOString(),
              relaunched: true,
              offeredCount: 1,
            },
          },
        };
      }
      throw new Error(`POST inesperado: ${url}`);
    });

    renderModal();
    await fillValidRide();
    fireEvent.click(screen.getByRole('button', { name: 'LANÇAR CORRIDA' }));

    const relaunch = await screen.findByRole('button', { name: 'LANÇAR NOVAMENTE' });
    fireEvent.click(relaunch);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/rides/ride-1/relaunch'));
    await screen.findByText(/Aguardando um motorista aceitar/);
  });
});
