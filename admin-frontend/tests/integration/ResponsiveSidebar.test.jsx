import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import Layout from '../../src/components/layout/Layout';

// Responsividade do painel admin (2026-08-08): confirma que o drawer off-canvas da
// sidebar (abaixo de md:) abre/fecha de verdade — hambúrguer some/mostra o menu,
// overlay fecha ao clicar fora, item de navegação fecha ao ser clicado. Só CSS/markup
// (classes de translate), nenhuma lógica de auth/dados é exercida aqui de propósito
// (useAuth mockado).
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'super_admin' }, logout: vi.fn() }),
}));

const renderLayout = () => render(
  <MemoryRouter initialEntries={['/dashboard']}>
    <Layout />
  </MemoryRouter>
);

describe('Sidebar responsiva (drawer off-canvas abaixo de md:)', () => {
  it('começa fechada (fora da tela) e abre ao tocar no hambúrguer', () => {
    renderLayout();

    const aside = document.querySelector('aside');
    expect(aside.className).toMatch(/-translate-x-full/);

    fireEvent.click(screen.getByRole('button', { name: /abrir menu/i }));

    expect(aside.className).toMatch(/translate-x-0/);
    expect(aside.className).not.toMatch(/-translate-x-full/);
  });

  it('fecha ao clicar no overlay', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: /abrir menu/i }));

    const overlay = document.querySelector('.bg-black\\/40');
    expect(overlay).toBeInTheDocument();
    fireEvent.click(overlay);

    const aside = document.querySelector('aside');
    expect(aside.className).toMatch(/-translate-x-full/);
  });

  it('fecha ao clicar num item de navegação (não fica bloqueando a tela após navegar)', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: /abrir menu/i }));

    fireEvent.click(screen.getByRole('link', { name: /corridas & mapa/i }));

    const aside = document.querySelector('aside');
    expect(aside.className).toMatch(/-translate-x-full/);
  });

  it('fecha ao clicar no X dentro da própria sidebar', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: /abrir menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /fechar menu/i }));

    const aside = document.querySelector('aside');
    expect(aside.className).toMatch(/-translate-x-full/);
  });
});
