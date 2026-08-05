import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import api from '@/shared/services/axios';
import RideChat from '@/shared/components/RideChat';
import { SocketContext } from '@/shared/contexts/SocketContext';

// Fase 1 (C1): RideChat migrou do axios cru para a instância configurada.
vi.mock('@/shared/services/axios', () => ({
    default: {
        get: vi.fn(),
        patch: vi.fn(),
        post: vi.fn(),
    },
    refreshAccessToken: vi.fn(),
}));

vi.mock('@/shared/services/session', () => ({
    getAccessToken: () => 'user-token',
}));

describe('RideChat — PIN operacional', () => {
    it('persiste o PIN pelo HTTP e não depende de send-message no cliente', async () => {
        Element.prototype.scrollIntoView = vi.fn();
        const socket = {
            emit: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
        };
        api.get.mockResolvedValue({ data: { messages: [] } });
        api.patch.mockResolvedValue({ data: {} });
        api.post.mockResolvedValue({
            data: {
                _id: 'message-1',
                message: 'PIN da entrega: 4321',
                senderType: 'user',
                operationalType: 'delivery_pin',
                createdAt: new Date().toISOString(),
            },
        });

        render(
            <SocketContext.Provider value={{ socket }}>
                <RideChat
                    subject={{ _id: 'parcel-1', status: 'provider_accepted' }}
                    subjectType="parcel"
                    isOpen
                    onClose={vi.fn()}
                    currentUserType="user"
                    deliveryPin="4321"
                />
            </SocketContext.Provider>
        );

        await waitFor(() => expect(api.patch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: /enviar pin/i }));

        await waitFor(() => expect(api.post).toHaveBeenCalled());
        expect(api.post.mock.calls[0][1]).toEqual(expect.objectContaining({
            subjectType: 'parcel',
            subjectId: 'parcel-1',
            operationalType: 'delivery_pin',
        }));
        expect(socket.emit).not.toHaveBeenCalledWith(
            'send-message',
            expect.anything()
        );
        expect(await screen.findByText('PIN da entrega: 4321')).toBeInTheDocument();
    });
});
