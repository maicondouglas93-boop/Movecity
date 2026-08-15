import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import Home from '@/passenger/pages/Home';
import { UserDataContext } from '@/passenger/contexts/UserContext';
import { SocketContext } from '@/shared/contexts/SocketContext';
import { LocationContext } from '@/shared/contexts/LocationContext';
import { ToastProvider } from '@/shared/contexts/ToastContext';
import { RideContext } from '@/shared/contexts/RideContext';

vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  onMessage: vi.fn(),
  // Fase 5 da auditoria de push (2026-08-02): fcm.js agora checa isSupported() antes de
  // chamar getMessaging(), pra evitar uma unhandled rejection interna do SDK em
  // ambientes sem suporte (o próprio jsdom é um deles).
  isSupported: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/shared/services/fcm', () => ({
  requestFCMToken: vi.fn(),
  // A9 da auditoria de push (2026-08-02): Home.jsx passou a assinar push em primeiro
  // plano — o mock precisa devolver uma função de cancelamento, como o real faz.
  onForegroundMessage: vi.fn(() => () => {}),
}));

vi.mock('@/shared/services/mapsApi', () => ({
  reverseGeocode: vi.fn().mockResolvedValue({ address: 'Mocked Address' }),
}));

vi.mock('@/shared/services/vehicleCategoriesApi', () => ({
  getVehicleCategories: vi.fn().mockResolvedValue([]),
}));

// Auditoria de regressão de push (2026-08-03): Home.jsx passou a puxar
// @/shared/services/socketAuth (joinWithRetry), que por sua vez importa @/shared/services/axios —
// esse módulo faz `axios.create(...)` no topo do arquivo; como este teste já mocka o
// pacote 'axios' cru (auto-mock, sem create() de verdade), o import real de
// @/shared/services/axios quebrava o carregamento do arquivo inteiro. Mockado aqui pelo
// mesmo motivo que os outros serviços acima.
vi.mock('@/shared/services/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  refreshAccessToken: vi.fn(),
}));

vi.mock('@/shared/services/deviceIdentity', () => ({
  getDeviceId: () => 'test-device-home-0001',
}));

// Header.jsx (renderizado dentro de Home) passou a usar PwaUpdateContext (2026-08-04)
// pro botão "Atualizar app" — esse contexto chama useRegisterSW de
// 'virtual:pwa-register/react', um módulo virtual que só existe dentro do pipeline
// real do Vite (dev/build), não no ambiente do Vitest. Mocka o contexto direto, no
// mesmo espírito dos outros mocks de serviço acima.
vi.mock('@/shared/contexts/PwaUpdateContext', () => ({
  usePwaUpdate: () => ({
    needRefresh: false,
    updateServiceWorker: vi.fn(),
    checkForUpdate: vi.fn().mockResolvedValue(false),
  }),
}));

vi.mock('@/shared/contexts/PwaInstallContext', () => ({
  usePwaInstall: () => ({
    canInstall: false,
    installed: true,
    promptInstall: vi.fn(),
    isIos: false,
  }),
}));

// Mocks for GSAP
vi.mock('@gsap/react', () => ({
  useGSAP: vi.fn(),
}));

// Mocks for Leaflet (used in LiveTracking)
vi.mock('leaflet', () => {
  const L = {
    map: vi.fn(),
    tileLayer: vi.fn(),
    marker: vi.fn(),
    icon: vi.fn(),
    divIcon: vi.fn(),
    Icon: {
      Default: {
        prototype: { _getIconUrl: '' },
        mergeOptions: vi.fn()
      }
    }
  };
  return { default: L, ...L };
});

vi.mock('axios');
vi.mock('gsap', () => ({
  default: {
    to: vi.fn(),
  }
}));

// We must mock the navigator.geolocation for the useEffects
const mockGeolocation = {
  getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
};

globalThis.navigator.geolocation = mockGeolocation;

// Notification API mock
globalThis.Notification = {
  requestPermission: vi.fn().mockResolvedValue('granted'),
  permission: 'granted',
};

describe('Home Component', () => {
  const mockUser = {
    _id: 'mock-user-id',
    fullname: { firstname: 'John', lastname: 'Doe' },
  };

  const mockSocket = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connected: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // LocationContext faltava aqui, e por isso a Home nunca chegava a renderizar nestes
  // testes ("Cannot destructure property 'userLocation' of undefined") — as duas
  // asserções abaixo nunca foram exercidas de verdade. Foi essa lacuna que deixou
  // passar para produção um erro de temporal dead zone na própria Home (um useEffect
  // declarado antes de `addToast`, com ele no array de dependências). Com o provider
  // no lugar, um erro de render volta a quebrar o teste, que é o esperado.
  // Fase A da experiência de corrida ativa (2026-08-03): Home agora lê a corrida do
  // RideContext (que reconcilia com o backend) — o provider mockado abaixo cobre isso.
  const mockRideContext = {
    userRide: null,
    setUserRide: vi.fn(),
    captainRide: null,
    setCaptainRide: vi.fn(),
    syncUserRide: vi.fn().mockResolvedValue(null),
    syncCaptainRide: vi.fn().mockResolvedValue(null),
  };

  const renderWithProviders = (ui) => {
    return render(
      <BrowserRouter>
        <UserDataContext.Provider value={{ user: mockUser }}>
          <SocketContext.Provider value={{ socket: mockSocket }}>
            <LocationContext.Provider value={{ userLocation: null, locationRef: { current: null }, locationError: null }}>
              <ToastProvider>
                <RideContext.Provider value={mockRideContext}>
                  {ui}
                </RideContext.Provider>
              </ToastProvider>
            </LocationContext.Provider>
          </SocketContext.Provider>
        </UserDataContext.Provider>
      </BrowserRouter>
    );
  };

  it('renders the Home page and connects to socket', async () => {
    renderWithProviders(<Home />);
    
    // Check if greeting is present
    expect(screen.getByText(/John/)).toBeInTheDocument();
    
    // Check if socket join was emitted
    // Auditoria PWA (2026-08-03, C2): join agora exige o JWT do usuário — sem ele, o
    // backend rejeita a entrada. Auditoria de regressão de push (2026-08-03):
    // joinWithRetry emite via um callback (pra poder renovar o token e tentar de novo
    // se o join falhar), então o emit real leva um terceiro argumento agora.
    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'join',
        {
          userType: 'user',
          userId: 'mock-user-id',
          token: null,
          deviceId: 'test-device-home-0001',
        },
        expect.any(Function)
      );
    });
  });

  it('listens for socket ride events', async () => {
    renderWithProviders(<Home />);

    expect(mockSocket.on).toHaveBeenCalledWith('ride-confirmed', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('ride-started', expect.any(Function));
  });
});
