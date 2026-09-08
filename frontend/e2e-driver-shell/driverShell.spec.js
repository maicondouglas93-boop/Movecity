import { test, expect } from '@playwright/test'

for (const viewport of [
    { width: 360, height: 640, font: 16 },
    { width: 390, height: 844, font: 16 },
    { width: 320, height: 568, font: 16 },
    { width: 360, height: 640, font: 24 },
]) {
    test(`oferta acima da conta: ${viewport.width}x${viewport.height}, fonte ${viewport.font}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport)
        // Isolamento: nem APIs, mapas, analytics ou socket acessam produção.
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
            ? route.continue() : route.abort())
        await page.goto('/e2e-driver-shell/fixtures/driver-shell.html')
        await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px` }, viewport.font)
        await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveCount(1)
        await page.getByRole('textbox', { name: 'Anotação de teste' }).fill('Preservar ao receber oferta')
        await page.getByRole('button', { name: 'Receber oferta de teste' }).click()
        const dialog = page.getByRole('dialog', { name: 'Oferta de corrida' })
        await expect(dialog).toBeFocused()
        expect(await page.locator('[data-driver-shell]').evaluate(node => node.inert)).toBe(true)
        const accept = dialog.getByRole('button', { name: 'Aceitar', exact: true })
        await accept.scrollIntoViewIfNeeded()
        const box = await accept.boundingBox()
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
        expect(await accept.evaluate(node => {
            const rect = node.getBoundingClientRect()
            return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        })).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath('oferta.png') })
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(page.getByRole('textbox', { name: 'Anotação de teste' })).toHaveValue('Preservar ao receber oferta')
        await expect(page.getByRole('button', { name: 'Receber oferta de teste' })).toBeFocused()
    })
}
