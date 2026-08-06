import { test, expect } from '@playwright/test';

/**
 * Smoke E2E no CI: valida que as telas de login sobem no build web.
 * O fluxo completo de corrida (backend + seed + socket) fica fora do gate do Actions.
 */
test.describe('Frontend smoke E2E', () => {
  test('login do motorista carrega', async ({ page }) => {
    await page.goto('/captain-login');
    await expect(page.getByPlaceholder('email@exemplo.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Entrar$/i })).toBeVisible();
  });

  test('login do passageiro carrega', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"], input[type="password"]').first()).toBeVisible();
  });
});
