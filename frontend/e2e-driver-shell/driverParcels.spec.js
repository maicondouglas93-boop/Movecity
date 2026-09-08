import { test, expect } from '@playwright/test'

async function reachable(control, viewport) {
    await control.scrollIntoViewIfNeeded()
    const box = await control.boundingBox()
    expect(box.y).toBeGreaterThanOrEqual(-1)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
    expect(await control.evaluate(node => {
        const r = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })).toBe(true)
}
for (const viewport of [{ width: 320, height: 568, font: 16 }, { width: 360, height: 640, font: 24 }, { width: 844, height: 390, font: 16 }]) {
    for (const mode of ['parcel', 'scheduled']) {
        test(`${mode}: ${viewport.width}x${viewport.height}, fonte ${viewport.font}`, async ({ page }, testInfo) => {
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.setViewportSize(viewport)
            await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
            await page.route('**/src/shared/components/LiveTracking.jsx*', route => route.fulfill({ contentType: 'text/javascript', body: 'export default function MapStub() { return null }' }))
            await page.goto(`/e2e-driver-shell/fixtures/driver-parcels.html?mode=${mode}`)
            await expect(page.locator('#root')).not.toBeEmpty()
            await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px` }, viewport.font)
            if (mode === 'parcel') {
                await page.getByLabel('PIN do destinatário').fill('1234')
                const delivery = page.getByRole('button', { name: 'Confirmar entrega', exact: true })
                await reachable(delivery, viewport)
                await delivery.click()
                await expect(page.getByRole('alert')).toContainText('A confirmação não foi obtida')
                await expect(page.getByRole('alert')).not.toContainText('PIN inválido')
                await expect(delivery).toBeDisabled()
                const retry = page.getByRole('button', { name: 'Consultar estado no servidor' })
                await reachable(retry, viewport)
                await page.screenshot({ path: testInfo.outputPath('encomenda-recuperacao.png') })
                await page.evaluate(() => { window.fixtureParcelFailure = false })
                await retry.click()
                await reachable(delivery, viewport)
                await delivery.click()
                await expect(page.getByText('Entrega confirmada pelo servidor')).toBeVisible()
                await expect(page.getByText(/não comprova dinheiro ou Pix recebido/)).toBeVisible()
                await reachable(page.getByRole('button', { name: '5 estrelas' }), viewport)
                const skip = page.getByRole('button', { name: 'Pular', exact: true })
                await reachable(skip, viewport)
                await page.screenshot({ path: testInfo.outputPath('encomenda-entregue.png') })
                await skip.click()
                await expect(page.getByText('Início de teste')).toBeVisible()
                expect(await page.evaluate(() => window.fixtureParcelWrites)).toBe(2)
            } else {
                await expect(page.getByText('Não foi possível consultar os agendados.')).toBeVisible()
                const retry = page.getByRole('button', { name: 'Atualizar agendados' })
                await reachable(retry, viewport)
                await page.evaluate(() => { window.fixtureParcelFailure = false })
                await retry.click()
                await expect(page.getByText('R$ 22,00')).toBeVisible()
                await expect(page.getByText('R$ 25,00')).toHaveCount(0)
                await expect(page.getByText(/Retirada: Avenida da retirada, 123, bairro São Sebastião/)).toBeVisible()
                await page.screenshot({ path: testInfo.outputPath('agendados.png') })
            }
            expect(errors).toEqual([])
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        })
    }
}
