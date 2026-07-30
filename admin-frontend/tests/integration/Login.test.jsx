import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/contexts/AuthContext';
import Login from '../../src/pages/Login';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const renderWithProviders = (ui) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          {ui}
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('Testes de Integração da Tela de Login', () => {
  it('Deve mostrar erro de credenciais inválidas', async () => {
    renderWithProviders(<Login />);
    
    fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'errado@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Senha/i), { target: { value: 'senhaerrada' } });
    
    fireEvent.click(screen.getByRole('button', { name: /Entrar no Painel/i }));

    await waitFor(() => {
      expect(screen.getByText(/Credenciais inválidas/i)).toBeInTheDocument();
    });
  });

  it('Deve fazer login com sucesso e armazenar token', async () => {
    renderWithProviders(<Login />);
    
    fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Senha/i), { target: { value: 'correct123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /Entrar no Painel/i }));

    await waitFor(() => {
      expect(localStorage.getItem('token')).toBe('fake-jwt-token-123');
    });
  });
});
