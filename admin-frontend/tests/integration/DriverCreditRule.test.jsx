import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DriverCreditRule from '../../src/components/DriverCreditRule';
import api from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';

vi.mock('../../src/services/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../src/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><DriverCreditRule /></QueryClientProvider>);
}

describe('DriverCreditRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ user: { role: 'super_admin' } });
    api.get.mockResolvedValue({ data: { blockDriverOnNegativeBalance: true, version: 2 } });
  });

  it('salva desligamento com a versão lida e mostra somente o resultado confirmado', async () => {
    let resolveSave;
    api.put.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
    show();
    expect(await screen.findByText('Regra salva: ativada.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bloquear motoristas com crédito negativo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar regra de crédito' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/settings/driver-credit', { blockDriverOnNegativeBalance: false, version: 2 }));
    expect(screen.getByText('Regra salva: ativada.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await act(async () => resolveSave({ data: { blockDriverOnNegativeBalance: false, version: 3 } }));
    expect(await screen.findByText('Regra salva: desativada.')).toBeInTheDocument();
  });

  it('financeiro consulta mas não pode alterar a regra', async () => {
    useAuth.mockReturnValue({ user: { role: 'financeiro' } });
    show();
    await screen.findByText('Regra salva: ativada.');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salvar regra de crédito' })).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('proprietário reativa o bloqueio anteriormente desligado', async () => {
    useAuth.mockReturnValue({ user: { role: 'OWNER' } });
    api.get.mockResolvedValue({ data: { blockDriverOnNegativeBalance: false, version: 3 } });
    api.put.mockResolvedValue({ data: { blockDriverOnNegativeBalance: true, version: 4 } });
    show();
    await screen.findByText('Regra salva: desativada.');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar regra de crédito' }));
    expect(await screen.findByText('Regra salva: ativada.')).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledWith('/admin/settings/driver-credit', { blockDriverOnNegativeBalance: true, version: 3 });
  });

  it('falha de leitura oferece nova tentativa sem exibir uma regra presumida', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    show();
    await screen.findByRole('alert');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar novamente' }));
    expect(await screen.findByText('Regra salva: ativada.')).toBeInTheDocument();
  });

  it('conflito de edição permite conferir o valor atual antes de salvar novamente', async () => {
    api.put.mockRejectedValue({ response: { status: 409, data: { message: 'A regra foi alterada por outro administrador.' } } });
    show();
    await screen.findByText('Regra salva: ativada.');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar regra de crédito' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outro administrador');
    api.get.mockResolvedValue({ data: { blockDriverOnNegativeBalance: false, version: 4 } });
    fireEvent.click(screen.getByRole('button', { name: 'Conferir regra atual' }));
    expect(await screen.findByText('Regra salva: desativada.')).toBeInTheDocument();
  });
});
