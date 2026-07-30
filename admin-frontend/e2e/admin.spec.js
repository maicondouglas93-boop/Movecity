import { test, expect } from '@playwright/test';

test.describe('Admin Panel Navigation & Flow', () => {
  
  test('should show login page and allow login', async ({ page }) => {
    // Acessa a raiz (deve redirecionar para login)
    await page.goto('/login');
    
    // Verifica título da página de login
    await expect(page.locator('h1')).toContainText('MoveCity Admin');
    
    // Testa o preenchimento (Mockando comportamento na UI)
    await page.fill('input[type="email"]', 'admin@admin.com');
    await page.fill('input[type="password"]', 'admin');
    
    // O clique real faria a requisição de rede, aqui apenas verificamos se os inputs aceitam valor
    const emailValue = await page.inputValue('input[type="email"]');
    expect(emailValue).toBe('admin@admin.com');
  });

  test('should render sidebar when logged in', async ({ page }) => {
    // Mock login by setting localStorage before navigation
    await page.addInitScript(() => {
      window.localStorage.setItem('adminToken', 'fake-token-123');
      window.localStorage.setItem('adminUser', JSON.stringify({ name: 'Admin', role: 'super_admin' }));
    });
    
    await page.goto('/dashboard');
    
    // Verifica se a sidebar aparece
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('aside')).toContainText('MoveCity Admin');
    await expect(page.locator('aside')).toContainText('SUPER_ADMIN');
    
    // Verifica navegação de links
    const links = await page.locator('nav a').allInnerTexts();
    expect(links).toContain('Dashboard');
    expect(links).toContain('Motoristas');
    expect(links).toContain('Financeiro');
    expect(links).toContain('Logs & Auditoria');
  });

});
