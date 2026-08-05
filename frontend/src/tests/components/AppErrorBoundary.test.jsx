import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AppErrorBoundary from '@/shared/components/AppErrorBoundary';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({
    captureException: (...args) => captureException(...args),
}));

function Bomb() {
    throw new Error('crash de render proposital');
}

describe('AppErrorBoundary — Fase 1 (C2)', () => {
    it('captura crash de render e mostra o fallback em vez de tela branca', () => {
        // React loga o erro no console mesmo capturado pelo boundary — silencia só aqui.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <AppErrorBoundary>
                <Bomb />
            </AppErrorBoundary>
        );

        expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /recarregar aplicativo/i })).toBeInTheDocument();
        // Não expõe stack trace nem detalhes técnicos para o usuário.
        expect(screen.queryByText(/crash de render proposital/)).not.toBeInTheDocument();
        // Reporta ao Sentry existente (no-op seguro quando não inicializado).
        expect(captureException).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('renderiza os filhos normalmente quando não há erro', () => {
        render(
            <AppErrorBoundary>
                <p>conteúdo saudável</p>
            </AppErrorBoundary>
        );
        expect(screen.getByText('conteúdo saudável')).toBeInTheDocument();
        expect(screen.queryByText('Algo deu errado')).not.toBeInTheDocument();
    });
});
