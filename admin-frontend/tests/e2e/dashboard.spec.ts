import { test, expect } from '@playwright/test';

test.describe('Admin smoke E2E', () => {
  test('página de login carrega com formulário', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('admin@movecity.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /Entrar no Sistema/i })).toBeVisible();
  });

  test('credenciais inválidas permanecem na tela de login', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('admin@movecity.com').fill('erro@test.com');
    await page.locator('input[type="password"]').fill('senhaerrada');
    await page.getByRole('button', { name: /Entrar no Sistema/i }).click();
    // Sem backend no CI: a UI não deve navegar para o dashboard.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /Entrar no Sistema/i })).toBeVisible();
  });
});
