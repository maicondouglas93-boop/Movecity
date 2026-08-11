import React, { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import Rides from '../../src/pages/Rides';
import api from '../../src/services/api';

const markerUnmounted = vi.hoisted(() => vi.fn());
const mapRendered = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/api', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));

vi.mock('../../src/contexts/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

vi.mock('../../src/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../src/contexts/ConfirmContext', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../src/contexts/PromptContext', () => ({
  usePrompt: () => vi.fn(),
}));

vi.mock('../../src/components/rides/RideRow', () => ({
  default: () => null,
}));

vi.mock('../../src/components/rides/RideDrawer', () => ({
  default: () => null,
}));

vi.mock('../../src/components/rides/FinalizeRideModal', () => ({
  default: () => null,
}));

vi.mock('../../src/components/rides/ManualRideModal', () => ({
  default: ({ onClose }) => (
    <div role="dialog" aria-label="Lançar corrida">
      <button type="button" onClick={onClose}>Fechar corrida manual</button>
    </div>
  ),
}));

vi.mock('leaflet', () => ({
  default: {
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
    divIcon: vi.fn(() => ({})),
    latLngBounds: vi.fn(() => ({ isValid: () => false })),
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => {
    mapRendered();
    return <div data-testid="map">{children}</div>;
  },
  TileLayer: () => null,
  Marker: ({ children }) => {
    useEffect(() => () => markerUnmounted(), []);
    return <div data-testid="driver-marker">{children}</div>;
  },
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
}));

function renderRides() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/rides']}>
      <QueryClientProvider client={queryClient}>
        <Rides />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('estabilidade do mapa ao lançar corrida', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation(async (url) => {
      if (url === '/admin/captains/live-map') {
        return {
          data: {
            drivers: [{
              captainId: 'captain-1',
              name: 'João',
              ltd: -20.15,
              lng: -41.62,
              status: 'available',
            }],
          },
        };
      }
      if (url.startsWith('/admin/rides?')) {
        return {
          data: {
            rides: [],
            total: 0,
            pages: 1,
            summary: { requested: 0, ongoing: 0, finished: 0, cancelled: 0 },
          },
        };
      }
      throw new Error(`GET inesperado: ${url}`);
    });
  });

  it('mantém Marker/Popup montados quando o modal de corrida manual abre', async () => {
    renderRides();

    await waitFor(() => expect(screen.getByTestId('driver-marker')).toBeInTheDocument());
    await screen.findByText('Nenhuma corrida ou encomenda encontrada.');
    const rendersBeforeOpening = mapRendered.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Lançar corrida' }));

    expect(screen.getByRole('dialog', { name: 'Lançar corrida' })).toBeInTheDocument();
    expect(screen.getByTestId('driver-marker')).toBeInTheDocument();
    expect(markerUnmounted).not.toHaveBeenCalled();
    expect(mapRendered).toHaveBeenCalledTimes(rendersBeforeOpening);
  });
});
