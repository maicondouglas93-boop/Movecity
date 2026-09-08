import { test, expect } from '@playwright/test'

async function isolate(page) {
    await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/captains/summary') return route.fulfill({ json: { earnings: 42, ridesToday: 3, onlineTimeSeconds: 3600 } })
        return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
    })
}
async function unobscured(page, element, height) {
    await element.scrollIntoViewIfNeeded()
    await element.evaluate(node => node.scrollIntoView({ block: 'center' }))
    const box = await element.boundingBox()
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(height)
    expect(await element.evaluate(node => {
        const rect = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
for (const viewport of [{ width: 320, height: 568, font: 16 }, { width: 360, height: 640, font: 24 }]) {
    for (const [mode, title] of [['offline', 'Você está offline'], ['online', 'Disponível para solicitações'], ['gps', 'Aguardando localização'], ['reconnecting', 'Reconectando ao MoveCity']]) {
        test(`Home ${mode}: ${viewport.width}px, fonte ${viewport.font}`, async ({ page }, testInfo) => {
            await page.setViewportSize(viewport)
            await isolate(page)
            await page.goto(`/e2e-driver-shell/fixtures/driver-home.html?mode=${mode}`)
            await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px` }, viewport.font)
            await expect(page.getByRole('heading', { name: title })).toBeVisible()
            const action = page.getByRole('button', { name: mode === 'offline' ? 'Ficar online' : 'Ficar offline' })
            await unobscured(page, action, viewport.height)
            await page.screenshot({ path: testInfo.outputPath('home.png') })
            await unobscured(page, page.getByRole('button', { name: /Corrida presencial/ }), viewport.height)
            expect(await page.locator('details').evaluate(node => node.open)).toBe(false)
        })
    }
    test(`embarque: ${viewport.width}px, fonte ${viewport.font}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport)
        await isolate(page)
        await page.goto('/e2e-driver-shell/fixtures/driver-home.html?mode=pickup')
        await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px` }, viewport.font)
        const dialog = page.getByRole('dialog', { name: 'Embarque da corrida' })
        await expect(dialog.getByRole('heading', { name: 'Corrida aceita' })).toBeVisible()
        await expect(dialog.getByRole('link', { name: 'Abrir embarque no Google Maps' })).toHaveAttribute('href', /destination=-20.15,-41.62/)
        await unobscured(page, dialog.getByRole('link', { name: 'Ligar para o passageiro' }), viewport.height)
        await unobscured(page, dialog.getByRole('button', { name: 'A caminho', exact: true }), viewport.height)
        await page.screenshot({ path: testInfo.outputPath('embarque.png') })
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
        const cancel = dialog.getByRole('button', { name: 'Confirmar cancelamento' })
        await unobscured(page, cancel, viewport.height)
    })
}
