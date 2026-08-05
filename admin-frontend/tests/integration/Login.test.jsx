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

// Fase 2 (H4, 2026-08-05): o teste estava quebrado há tempo — procurava placeholders
// (/Email/i, /Senha/i), botão ("Entrar no Painel") e chave de storage ('token') que a
// tela e o AuthContext não usam mais. Atualizado para o contrato atual: placeholders
// reais, botão "Entrar no Sistema" e 'adminToken' no localStorage.
describe('Testes de Integração da Tela de Login', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Deve mostrar erro de credenciais inválidas', async () => {
    renderWithProviders(<Login />);

    fireEvent.change(screen.getByPlaceholderText('admin@movecity.com'), { target: { value: 'errado@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'senhaerrada' } });

    fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/i }));

    await waitFor(() => {
      expect(screen.getByText(/Credenciais inválidas/i)).toBeInTheDocument();
    });
  });

  it('Deve fazer login com sucesso e armazenar token', async () => {
    renderWithProviders(<Login />);

    fireEvent.change(screen.getByPlaceholderText('admin@movecity.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'correct123' } });

    fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/i }));

    await waitFor(() => {
      expect(localStorage.getItem('adminToken')).toBe('fake-jwt-token-123');
    });
  });
});
