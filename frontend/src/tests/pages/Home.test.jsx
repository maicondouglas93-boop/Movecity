import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import Home from '../../pages/Home';
import { UserDataContext } from '../../context/UserContext';
import { SocketContext } from '../../context/SocketContext';
import { ToastProvider } from '../../context/ToastContext';

vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  onMessage: vi.fn(),
}));

vi.mock('../../services/fcm', () => ({
  requestFCMToken: vi.fn(),
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

global.navigator.geolocation = mockGeolocation;

// Notification API mock
global.Notification = {
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

  const renderWithProviders = (ui) => {
    return render(
      <BrowserRouter>
        <UserDataContext.Provider value={{ user: mockUser }}>
          <SocketContext.Provider value={{ socket: mockSocket }}>
            <ToastProvider>
              {ui}
            </ToastProvider>
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
    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith('join', { userType: 'user', userId: 'mock-user-id' });
    });
  });

  it('listens for socket ride events', async () => {
    renderWithProviders(<Home />);

    expect(mockSocket.on).toHaveBeenCalledWith('ride-confirmed', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('ride-started', expect.any(Function));
  });
});
