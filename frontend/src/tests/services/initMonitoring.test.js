import { describe, it, expect, vi } from 'vitest';

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    browserTracingIntegration: vi.fn(),
    replayIntegration: vi.fn(),
}));

const { resolveTracePropagationTargets } = await import('@/shared/bootstrap/initMonitoring');

// Fase 2 (H3): o tracing precisa apontar pra API real (derivada de VITE_BASE_URL),
// não pro placeholder yourserver.io que nunca propagou nada em produção.
describe('resolveTracePropagationTargets', () => {
    it('inclui a origin de produção derivada de VITE_BASE_URL', () => {
        expect(resolveTracePropagationTargets({ VITE_BASE_URL: 'https://movecity.onrender.com' }))
            .toEqual(['localhost', 'https://movecity.onrender.com']);
    });

    it('não duplica localhost quando a base é local', () => {
        expect(resolveTracePropagationTargets({ VITE_BASE_URL: 'http://localhost:3000' }))
            .toEqual(['localhost']);
    });

    it('degrada para só localhost com VITE_BASE_URL ausente/inválida', () => {
        expect(resolveTracePropagationTargets({})).toEqual(['localhost']);
        expect(resolveTracePropagationTargets({ VITE_BASE_URL: 'não é url' })).toEqual(['localhost']);
    });
});
