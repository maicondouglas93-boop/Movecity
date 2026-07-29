import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import axios from 'axios';
import UserLogin from '../../pages/UserLogin';
import { UserDataContext } from '../../context/UserContext';
import { ToastProvider } from '../../context/ToastContext';

// Mock dependências externas
vi.mock('axios');
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
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

  it('handles successful login', async () => {
    axios.post.mockResolvedValueOnce({
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
      expect(axios.post).toHaveBeenCalledWith(`${import.meta.env.VITE_BASE_URL}/users/login`, {
        email: 'test@test.com',
        password: 'password123'
      });
      expect(mockSetUser).toHaveBeenCalledWith({ fullname: { firstname: 'John' } });
      expect(mockNavigate).toHaveBeenCalledWith('/home');
    });
  });

  it('handles failed login', async () => {
    axios.post.mockRejectedValueOnce({
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
