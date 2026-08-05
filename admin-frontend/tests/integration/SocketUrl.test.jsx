import { describe, it, expect } from 'vitest';
import { resolveSocketUrl } from '../../src/contexts/SocketContext';

// Fase 1 da auditoria de production readiness (C3, 2026-08-05): o Socket.IO do
// painel precisa conectar na ORIGIN do backend — VITE_API_URL carrega o sufixo /api
// da API REST, que não pode vazar para o handshake do socket.
describe('resolveSocketUrl', () => {
    it('remove o path /api da URL da API REST', () => {
        expect(resolveSocketUrl({ VITE_API_URL: 'https://movecity.onrender.com/api' }))
            .toBe('https://movecity.onrender.com');
    });

    it('preserva origin com porta em desenvolvimento', () => {
        expect(resolveSocketUrl({ VITE_API_URL: 'http://localhost:3000/api' }))
            .toBe('http://localhost:3000');
        expect(resolveSocketUrl({ VITE_API_URL: 'http://localhost:3000' }))
            .toBe('http://localhost:3000');
    });

    it('usa VITE_SOCKET_URL quando definida (override explícito)', () => {
        expect(resolveSocketUrl({
            VITE_API_URL: 'https://movecity.onrender.com/api',
            VITE_SOCKET_URL: 'https://sockets.movecity.com',
        })).toBe('https://sockets.movecity.com');
    });

    it('cai no default localhost quando nada está configurado', () => {
        expect(resolveSocketUrl({})).toBe('http://localhost:3000');
    });

    it('não devolve URL com /api em nenhum cenário sem override', () => {
        const result = resolveSocketUrl({ VITE_API_URL: 'https://backend.exemplo.com/api' });
        expect(result.includes('/api')).toBe(false);
    });
});
