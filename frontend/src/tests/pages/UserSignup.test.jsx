import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import api from '@/shared/services/axios';
import UserSignup from '@/passenger/pages/UserSignup';
import { UserDataContext } from '@/passenger/contexts/UserContext';
import { ToastProvider } from '@/shared/contexts/ToastContext';
import { getGoogleIdToken } from '@/shared/services/googleAuth';

// Fase 1 (C1): a página migrou do axios cru para a instância configurada.
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

describe('UserSignup Component', () => {
  const mockSetUser = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders signup form correctly', () => {
    renderWithProviders(<UserSignup />);
    
    expect(screen.getByPlaceholderText('Nome')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Sobrenome')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('CPF (apenas números)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Celular (ex: +5511999999999)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('email@exemplo.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('senha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar conta/i })).toBeInTheDocument();
  });

  it('handles successful signup', async () => {
    api.post.mockResolvedValueOnce({
      status: 201,
      data: {
        token: 'fake-jwt-token',
        user: { fullname: { firstname: 'Jane' } }
      }
    });

    renderWithProviders(<UserSignup />);
    
    fireEvent.change(screen.getByPlaceholderText('Nome'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByPlaceholderText('Sobrenome'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByPlaceholderText('CPF (apenas números)'), { target: { value: '12345678901' } });
    fireEvent.change(screen.getByPlaceholderText('Celular (ex: +5511999999999)'), { target: { value: '+5511999999999' } });
    fireEvent.change(screen.getByPlaceholderText('email@exemplo.com'), { target: { value: 'jane@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('senha'), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(`${import.meta.env.VITE_BASE_URL}/users/register`, {
        fullname: { firstname: 'Jane', lastname: 'Doe' },
        cpf: '12345678901',
        phone: '+5511999999999',
        email: 'jane@test.com',
        password: 'password123'
      });
      expect(mockSetUser).toHaveBeenCalledWith({ fullname: { firstname: 'Jane' } });
      expect(mockNavigate).toHaveBeenCalledWith('/home');
    });
  });

  it('informa quando o login Google nativo falha', async () => {
    getGoogleIdToken.mockRejectedValueOnce({
      code: 'GOOGLE_AUTH_FAILED',
      message: 'Não foi possível abrir o login Google.',
    });

    renderWithProviders(<UserSignup />);
    fireEvent.click(screen.getByRole('button', { name: /entrar com o google/i }));

    await waitFor(() => {
      expect(screen.getByText('Erro no Google: Não foi possível abrir o login Google.')).toBeInTheDocument();
    });
  });

  it('confirma vínculo de conta existente sem enviar senha no primeiro login Google', async () => {
    getGoogleIdToken.mockResolvedValue('google-id-token');
    api.post
      .mockRejectedValueOnce({
        response: { data: { code: 'GOOGLE_LINK_PASSWORD_REQUIRED' } }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          token: 'access-token',
          user: { fullname: { firstname: 'Pessoa' } },
        }
      });

    renderWithProviders(<UserSignup />);
    fireEvent.change(screen.getByPlaceholderText('senha'), { target: { value: 'senha-atual' } });
    const googleButton = screen.getByRole('button', { name: /entrar com o google/i });
    fireEvent.click(googleButton);

    await waitFor(() => {
      expect(api.post).toHaveBeenNthCalledWith(
        1,
        `${import.meta.env.VITE_BASE_URL}/users/google-login`,
        { idToken: 'google-id-token' }
      );
    });

    fireEvent.click(googleButton);
    await waitFor(() => {
      expect(api.post).toHaveBeenNthCalledWith(
        2,
        `${import.meta.env.VITE_BASE_URL}/users/google-login`,
        { idToken: 'google-id-token', password: 'senha-atual' }
      );
      expect(mockNavigate).toHaveBeenCalledWith('/home');
    });
  });
});
