import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { RideContext } from '@/shared/contexts/RideContext';
import { SocketContext } from '@/shared/contexts/SocketContext';
import { ToastProvider } from '@/shared/contexts/ToastContext';
import CaptainParcelRiding from '@/driver/pages/CaptainParcelRiding';
import { CaptainDataContext } from '@/driver/contexts/CaptainContext';
import { confirmParcelDelivery, confirmParcelPayment, skipCaptainParcelReview, updateParcelStatus } from '@/shared/services/parcelApi';
import { submitCaptainReview } from '@/shared/services/reviewApi';
const identity = vi.hoisted(() => ({ owner: 'c1' }));
vi.mock('@/shared/services/session', async () => ({ ...(await vi.importActual('@/shared/services/session')), getSessionOwnerId: () => identity.owner }));
vi.mock('@/shared/platform/appLifecycle.service', () => ({ onAppActive: () => () => {} }));

// Bug (auditoria do app do motorista, 2026-08-11, P0): aceitar uma encomenda pelo botão
// de ação da notificação nativa Android (app em segundo plano) manda pra /captain-parcel
// sem location.state — a tela mostrava "Nenhuma encomenda ativa" IMEDIATAMENTE, antes da
// busca ao backend terminar, levando o motorista a achar que não tinha aceitado nada.
// Estes testes fixam: nunca mostrar "sem encomenda" antes de confirmar com o backend.

vi.mock('@/shared/components/LiveTracking', () => ({
    default: () => <div data-testid="live-tracking-stub" />,
}));
vi.mock('@/shared/components/RideChat', () => ({ default: () => null }));
vi.mock('@/shared/services/parcelApi', () => ({
    confirmParcelDelivery: vi.fn(),
    confirmParcelPayment: vi.fn(),
    skipCaptainParcelReview: vi.fn(),
    updateParcelStatus: vi.fn(),
}));
vi.mock('@/shared/services/reviewApi', () => ({ submitCaptainReview: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => mockNavigate };
});

const activeParcel = {
    _id: 'parcel1',
    status: 'provider_accepted',
    paymentStatus: 'pending',
    pickup: 'Rua A, 1',
    destination: 'Rua B, 2',
    vehicleType: 'car',
    fare: 25,
};

function renderWithProviders({ syncCaptainParcel, captainParcel = null, publish = vi.fn(), socket = null }) {
    return render(
        <MemoryRouter initialEntries={['/captain-parcel']}>
            <ToastProvider>
                <CaptainDataContext.Provider value={{ captain: { _id: 'c1' } }}><SocketContext.Provider value={{ socket }}>
                    <RideContext.Provider value={{ captainParcel, captainParcelOwnerId: 'c1', setCaptainParcel: publish, syncCaptainParcel }}>
                        <CaptainParcelRiding />
                    </RideContext.Provider>
                </SocketContext.Provider></CaptainDataContext.Provider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe('CaptainParcelRiding — sem "Nenhuma encomenda ativa" antes de confirmar com o backend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        identity.owner = 'c1';
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); });

    it('mostra o spinner de carregamento, nunca "Nenhuma encomenda ativa", enquanto a sincronização está em andamento', () => {
        let resolveSync;
        const syncCaptainParcel = vi.fn(() => new Promise((resolve) => { resolveSync = resolve; }));
        renderWithProviders({ syncCaptainParcel });

        expect(screen.queryByText('Nenhuma encomenda ativa')).not.toBeInTheDocument();
        // resolve depois, fora da janela do teste — só garante que nada resolveu ainda.
        expect(resolveSync).toBeDefined();
    });

    it('aceite via notificação nativa (sem location.state): sincroniza e mostra a encomenda ativa, sem piscar "Nenhuma encomenda ativa"', async () => {
        const syncCaptainParcel = vi.fn().mockResolvedValue(activeParcel);
        renderWithProviders({ syncCaptainParcel });

        expect(screen.queryByText('Nenhuma encomenda ativa')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('live-tracking-stub')).toBeInTheDocument());
        expect(screen.queryByText('Nenhuma encomenda ativa')).not.toBeInTheDocument();
        expect(syncCaptainParcel).toHaveBeenCalledTimes(1);
    });

    it('sem encomenda local nem no backend: só redireciona pra Home depois de confirmar (nunca antes)', async () => {
        const syncCaptainParcel = vi.fn().mockResolvedValue(null);
        renderWithProviders({ syncCaptainParcel });

        expect(mockNavigate).not.toHaveBeenCalled();
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/captain-home', { replace: true }));
    });

    it('usa captainParcel do contexto como estado inicial quando location.state está vazio', () => {
        const syncCaptainParcel = vi.fn(() => new Promise(() => {})); // nunca resolve nesta janela
        renderWithProviders({ syncCaptainParcel, captainParcel: activeParcel });

        // Com captainParcel já disponível no contexto, a tela não deveria ficar presa no
        // spinner "puro" — o conteúdo da encomenda já pode montar imediatamente.
        expect(screen.getByTestId('live-tracking-stub')).toBeInTheDocument();
    });

    it.each([undefined, {}, { _id: 'parcel1', status: 'surprise' }])('resposta desconhecida não vira ausência: %j', async value => {
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue(value) });
        expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Consultar estado no servidor' })).toBeEnabled();
    });

    it('preserva a encomenda na falha e só habilita ação após consulta válida', async () => {
        const sync = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(activeParcel);
        renderWithProviders({ captainParcel: activeParcel, syncCaptainParcel: sync });
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Indo para retirada' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Consultar estado no servidor' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Indo para retirada' })).toBeEnabled());
    });

    it('um único toque lógico avança apenas após ACK e atualiza também o contexto', async () => {
        let resolve;
        updateParcelStatus.mockReturnValue(new Promise(r => { resolve = r; }));
        const publish = vi.fn();
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue(activeParcel), publish });
        const action = await screen.findByRole('button', { name: 'Indo para retirada' });
        fireEvent.click(action); fireEvent.click(action);
        expect(updateParcelStatus).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Cheguei na retirada' })).toBeNull();
        const updated = { ...activeParcel, status: 'going_to_pickup' };
        await act(async () => resolve(updated));
        expect(publish).toHaveBeenLastCalledWith(updated);
        expect(screen.getByRole('button', { name: 'Cheguei na retirada' })).toBeEnabled();
    });

    it('não aceita ACK de outra encomenda', async () => {
        updateParcelStatus.mockResolvedValue({ ...activeParcel, _id: 'other', status: 'going_to_pickup' });
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue(activeParcel) });
        fireEvent.click(await screen.findByRole('button', { name: 'Indo para retirada' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('A confirmação não foi obtida');
        expect(screen.getByRole('button', { name: 'Indo para retirada' })).toBeDisabled();
    });

    it('timeout de PIN não vira PIN inválido; consulta posterior recupera entrega aceita sem reenviar', async () => {
        const destination = { ...activeParcel, status: 'arrived_destination' };
        const finished = { ...activeParcel, status: 'finished', paymentStatus: 'paid' };
        const sync = vi.fn().mockResolvedValueOnce(destination).mockResolvedValue(finished);
        confirmParcelDelivery.mockReturnValue(new Promise(() => {}));
        renderWithProviders({ syncCaptainParcel: sync });
        fireEvent.change(await screen.findByLabelText('PIN do destinatário'), { target: { value: '1234' } });
        vi.useFakeTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar entrega' }));
        await act(async () => vi.advanceTimersByTimeAsync(12001));
        vi.useRealTimers();
        expect(screen.getByRole('alert')).not.toHaveTextContent('PIN inválido');
        expect(screen.queryByText('Entrega confirmada pelo servidor')).toBeNull();
        expect(screen.getByLabelText('PIN do destinatário')).toHaveValue('1234');
        fireEvent.click(screen.getByRole('button', { name: 'Consultar estado no servidor' }));
        expect(await screen.findByText('Entrega confirmada pelo servidor')).toBeInTheDocument();
        expect(screen.getByText(/não comprova dinheiro ou Pix recebido/)).toBeInTheDocument();
        expect(confirmParcelDelivery).toHaveBeenCalledTimes(1);
    });

    it('erro de PIN confirmado pelo servidor continua específico', async () => {
        confirmParcelDelivery.mockRejectedValue({ response: { status: 400, data: { message: 'PIN inválido' } } });
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue({ ...activeParcel, status: 'arrived_destination' }) });
        fireEvent.change(await screen.findByLabelText('PIN do destinatário'), { target: { value: '1234' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar entrega' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('PIN inválido');
    });

    it('sem internet não envia PIN nem declara entrega confirmada', async () => {
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue({ ...activeParcel, status: 'arrived_destination', requireDeliveryPin: false }) });
        const action = await screen.findByRole('button', { name: 'Confirmar entrega' });
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        fireEvent.click(action);
        expect(confirmParcelDelivery).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Nenhuma confirmação foi enviada');
        online.mockRestore();
    });

    it('pagamento só passa para avaliação com ACK paid da mesma encomenda', async () => {
        const unpaid = { ...activeParcel, status: 'finished' };
        confirmParcelPayment.mockResolvedValue(unpaid);
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue(unpaid) });
        fireEvent.click(await screen.findByRole('button', { name: 'Pagamento recebido' }));
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.queryByText('Avalie o cliente')).toBeNull();
    });

    it('pular avaliação não limpa atendimento se o servidor falhar', async () => {
        skipCaptainParcelReview.mockRejectedValue(new Error('network'));
        const publish = vi.fn();
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue({ ...activeParcel, status: 'finished', paymentStatus: 'paid' }), publish });
        fireEvent.click(await screen.findByRole('button', { name: 'Pular' }));
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(publish).not.toHaveBeenCalledWith(null);
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('avaliação válida sai uma vez, com nota acessível', async () => {
        submitCaptainReview.mockResolvedValue({ _id: 'review', subjectId: 'parcel1', subjectType: 'parcel' });
        renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue({ ...activeParcel, status: 'finished', paymentStatus: 'paid' }) });
        fireEvent.click(await screen.findByRole('button', { name: '5 estrelas' }));
        fireEvent.click(screen.getByRole('button', { name: 'Enviar e voltar' }));
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
        expect(submitCaptainReview).toHaveBeenCalledWith({ subjectType: 'parcel', parcelId: 'parcel1', rating: 5 });
    });

    it('ignora cancelamento de outra encomenda e consulta o da encomenda atual', async () => {
        const socket = { on: vi.fn(), off: vi.fn() };
        const sync = vi.fn().mockResolvedValueOnce(activeParcel).mockResolvedValue(null);
        renderWithProviders({ syncCaptainParcel: sync, socket });
        await screen.findByRole('button', { name: 'Indo para retirada' });
        const cancel = socket.on.mock.calls.find(([name]) => name === 'parcel-cancelled')[1];
        act(() => cancel({ parcelId: 'other' }));
        expect(sync).toHaveBeenCalledTimes(1);
        await act(async () => cancel({ parcelId: 'parcel1' }));
        expect(sync).toHaveBeenCalledTimes(2);
        expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it.each(['unmount', 'owner'])('descarta ACK tardio após %s', async change => {
        let resolve;
        updateParcelStatus.mockReturnValue(new Promise(r => { resolve = r; }));
        const publish = vi.fn();
        const view = renderWithProviders({ syncCaptainParcel: vi.fn().mockResolvedValue(activeParcel), publish });
        fireEvent.click(await screen.findByRole('button', { name: 'Indo para retirada' }));
        publish.mockClear();
        if (change === 'unmount') view.unmount(); else identity.owner = 'c2';
        await act(async () => resolve({ ...activeParcel, status: 'going_to_pickup' }));
        expect(publish).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
