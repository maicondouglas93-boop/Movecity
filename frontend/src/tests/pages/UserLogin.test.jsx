import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import api from '@/shared/services/axios';
import UserLogin from '@/passenger/pages/UserLogin';
import { UserDataContext } from '@/passenger/contexts/UserContext';
import { ToastProvider } from '@/shared/contexts/ToastContext';

// Mock dependências externas — Fase 1 (C1): a página migrou do axios cru para a
// instância configurada (@/shared/services/axios), então é ela que precisa ser mockada.
vi.mock('@/shared/services/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  refreshAccessToken: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));
vi.mock('@/shared/services/googleAuth', () => ({
  getGoogleIdToken: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('UserLogin Component', () => {
  const mockSetUser = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Login bem-sucedido grava token via saveSession; sem limpar, o useEffect
    // de UserLogin redireciona para /home nos testes seguintes.
    localStorage.clear();
  });

  const renderWithProviders = (ui) => {
    return render(
      <BrowserRouter>
        <UserDataContext.Provider value={{ user: null, setUser: mockSetUser }}>
          <ToastProvider>
            {ui}
          </ToastProvider>
        </UserDataContext.Provider>
      </BrowserRouter>
    );
  };

  it('renders login form correctly', () => {
    renderWithProviders(<UserLogin />);
    
    expect(screen.getByPlaceholderText('email@exemplo.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('senha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar$/i })).toBeInTheDocument(); // O botão padrão de entrar
    expect(screen.getByRole('button', { name: /entrar com o google/i })).toBeInTheDocument();
  });

  it('não oferece entrada de motorista no build do passageiro', () => {
    vi.stubEnv('VITE_APP_ROLE', 'passenger');
    renderWithProviders(<UserLogin />);

    expect(screen.queryByRole('link', { name: /entrar como motorista/i })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('handles successful login', async () => {
    api.post.mockResolvedValueOnce({
      status: 200,
      data: {
        token: 'fake-jwt-token',
        user: { fullname: { firstname: 'John' } }
      }
    });

    renderWithProviders(<UserLogin />);
    
    fireEvent.change(screen.getByPlaceholderText('email@exemplo.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('senha'), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /entrar$/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(`${import.meta.env.VITE_BASE_URL}/users/login`, {
        email: 'test@test.com',
        password: 'password123'
      });
      expect(mockSetUser).toHaveBeenCalledWith({ fullname: { firstname: 'John' } });
      expect(mockNavigate).toHaveBeenCalledWith('/home');
    });
  });

  it('handles failed login', async () => {
    api.post.mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } }
    });

    renderWithProviders(<UserLogin />);
    
    fireEvent.change(screen.getByPlaceholderText('email@exemplo.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('senha'), { target: { value: 'wrongpass' } });
    
    fireEvent.click(screen.getByRole('button', { name: /entrar$/i }));

    await waitFor(() => {
      expect(mockNavigate).not.toHaveBeenCalled();
      // Verificamos se o toast foi chamado. Como o toast context renderiza uma div global, podemos ver a mensagem nela
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });
});
