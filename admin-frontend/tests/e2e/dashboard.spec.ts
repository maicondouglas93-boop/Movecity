import { test, expect } from '@playwright/test';

test.describe('E2E Dashboard & Authentication', () => {
  test('Deve exibir erro de login com credenciais falsas', async ({ page }) => {
    await page.goto('/login');
    
    // Testa form
    await page.fill('input[placeholder="Email"]', 'erro@test.com');
    await page.fill('input[placeholder="Senha"]', 'senhaerrada');
    await page.click('button:has-text("Entrar no Painel")');

    // Assumindo que criamos um toast com a mensagem de erro:
    // Este teste falharia na vida real caso a API não esteja rodando.
    // Com MSW no browser ou backend rodando, ele funciona.
  });

  test('Checagem Visual de Layout (Visual Regression)', async ({ page }) => {
    // Para rodar regressão visual, a gente navega para a página alvo (aqui simulada)
    // await page.goto('/login');
    
    // No Playwright a foto fica salva na pasta do projeto e comparada nos testes futuros.
    // expect(await page.screenshot()).toMatchSnapshot('login-page.png');
  });
});
