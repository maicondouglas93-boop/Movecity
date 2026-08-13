import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import api from '@/shared/services/axios';
import UserSignup from '@/passenger/pages/UserSignup';
import { UserDataContext } from '@/passenger/contexts/UserContext';
import { ToastProvider } from '@/shared/contexts/ToastContext';

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
});
