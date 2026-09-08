import { test, expect } from '@playwright/test'

async function visibleControl(page, control, viewport) {
    await control.scrollIntoViewIfNeeded()
    const box = await control.boundingBox()
    expect(box.y).toBeGreaterThanOrEqual(-1)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
    expect(await control.evaluate(node => {
        const r = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
for (const viewport of [{ width: 320, height: 568, font: 16 }, { width: 360, height: 640, font: 24 }, { width: 844, height: 390, font: 16 }]) {
    for (const mode of ['server', 'local', 'gps', 'read-error']) {
        test(`viagem ${mode}: ${viewport.width}x${viewport.height}, fonte ${viewport.font}`, async ({ page }, testInfo) => {
            await page.setViewportSize(viewport)
            await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
            await page.goto(`/e2e-driver-shell/fixtures/driver-trip.html?mode=${mode}`)
            await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px` }, viewport.font)
            const finish = page.getByRole('button', { name: 'Finalizar corrida' })
            await visibleControl(page, finish, viewport)
            const map = await page.locator('[data-trip-map]').boundingBox()
            expect(map.height).toBeGreaterThanOrEqual(viewport.height * 0.14)
            const amount = page.locator('[data-trip-amount]')
            await amount.scrollIntoViewIfNeeded()
            await expect(amount).toHaveText(/28,31/)
            expect(await amount.evaluate(node => node.closest('[aria-live]')?.getAttribute('aria-live'))).toBe('off')
            if (mode === 'gps' || mode === 'local') {
                await expect(page.getByText('Vire à direita', { exact: false })).toHaveCount(0)
                await expect(page.getByText('Destino: cerca de', { exact: false })).toHaveCount(0)
            }
            await page.screenshot({ path: testInfo.outputPath('viagem.png') })
            await page.getByRole('button', { name: 'Ver detalhes da corrida e do sinal' }).click()
            await visibleControl(page, finish, viewport)
            if (mode === 'gps') await visibleControl(page, page.getByRole('button', { name: 'Revisar localização' }), viewport)
            if (mode === 'read-error') await visibleControl(page, page.getByRole('button', { name: 'Tentar atualizar medição' }), viewport)
            const help = page.getByRole('button', { name: 'Ajuda e segurança' })
            await visibleControl(page, help, viewport)
            await help.click()
            await expect(page.getByRole('dialog', { name: 'Ajuda e segurança' })).toBeFocused()
            expect(await page.locator('[data-driver-trip]').evaluate(node => node.inert)).toBe(true)
            await visibleControl(page, page.getByRole('link', { name: 'Polícia · 190' }), viewport)
            await visibleControl(page, page.getByRole('link', { name: 'Abrir WhatsApp do suporte' }), viewport)
            await page.screenshot({ path: testInfo.outputPath('ajuda.png') })
            await page.keyboard.press('Escape')
            await expect(page.getByRole('dialog')).toHaveCount(0)
            await expect(help).toBeFocused()
            await finish.click()
            await expect(page.getByRole('dialog', { name: 'Finalização de teste' })).toBeVisible()
        })
    }
}
