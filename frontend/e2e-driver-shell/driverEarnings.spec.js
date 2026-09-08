import { test, expect } from '@playwright/test'

for (const viewport of [{ width: 320, height: 568, font: 16 }, { width: 360, height: 640, font: 24 }, { width: 844, height: 390, font: 16 }]) {
    for (const mode of ['valid', 'error']) {
        test(`ganhos ${mode}: ${viewport.width}x${viewport.height}, fonte ${viewport.font}`, async ({ page }, testInfo) => {
            await page.setViewportSize(viewport)
            await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
            await page.goto(`/e2e-driver-shell/fixtures/driver-earnings.html?mode=${mode}`)
            await expect(page.getByRole('region', { name: 'Ganhos de hoje' })).toBeVisible()
            await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px` }, viewport.font)
            const summary = page.getByRole('region', { name: 'Ganhos de hoje' })
            if (mode === 'error') {
                await expect(summary).toContainText('Indisponível')
                await expect(page.getByText('R$ 0,00', { exact: true })).toHaveCount(0)
            } else {
                await expect(summary).toContainText('R$ 63,90')
                await page.evaluate(() => { window.fixtureEarningsFail = true })
                await summary.getByRole('button', { name: 'Atualizar período' }).click()
                await expect(summary).toContainText('Exibindo a última consulta válida')
                await expect(summary).toContainText('R$ 63,90')
            }
            await page.screenshot({ path: testInfo.outputPath('ganhos.png') })
            await page.evaluate(() => { window.fixtureEarningsFail = false })
            const retry = summary.getByRole('button', { name: 'Atualizar período' })
            await retry.click()
            await expect(summary).toContainText('R$ 63,90')
            await expect(summary.getByRole('status')).not.toContainText('Não foi possível')
            await page.getByRole('button', { name: '7 dias', exact: true }).click()
            await expect(page.getByRole('region', { name: 'Ganhos dos últimos 7 dias' })).toContainText('R$ 210,00')
            await page.getByText('Ganhos acumulados', { exact: true }).click()
            await expect(page.getByRole('region', { name: 'Total líquido acumulado' })).toContainText('R$ 850,00')
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
            await page.getByRole('button', { name: 'Atualizar app (teste)' }).click()
            const dialog = page.getByRole('dialog', { name: 'Atualização do aplicativo' })
            await expect(dialog).toBeFocused()
            await expect(dialog).toContainText('Não há verificação automática')
            await page.screenshot({ path: testInfo.outputPath('atualizacao.png') })
            await page.getByRole('button', { name: 'Fechar', exact: true }).scrollIntoViewIfNeeded()
            await page.keyboard.press('Escape')
            await expect(dialog).toHaveCount(0)
            await expect(page.getByRole('button', { name: 'Atualizar app (teste)' })).toBeFocused()
        })
    }
}
