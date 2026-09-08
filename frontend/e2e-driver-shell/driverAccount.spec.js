import { test, expect } from '@playwright/test'

async function visible(control, viewport) {
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
    for (const mode of ['login', 'documents', 'help', 'approval']) {
        test(`conta ${mode}: ${viewport.width}x${viewport.height}, fonte ${viewport.font}`, async ({ page }, testInfo) => {
            await page.setViewportSize(viewport)
            await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
            await page.goto(`/e2e-driver-shell/fixtures/driver-account.html?mode=${mode}`)
            await expect(page.locator('#root')).not.toBeEmpty()
            await page.evaluate(font => { document.documentElement.style.fontSize = `${font}px` }, viewport.font)
            if (mode === 'login') {
                await page.getByLabel('Qual é o seu email?').fill('synthetic@example.test')
                await page.getByLabel('Senha', { exact: true }).fill('synthetic-secret')
                await page.getByRole('button', { name: 'Mostrar senha' }).click()
                await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text')
                await page.getByRole('button', { name: 'Entrar', exact: true }).click()
                await expect(page.getByRole('alert')).toBeVisible()
                const help = page.getByRole('link', { name: 'Esqueci a senha / preciso de ajuda' })
                await visible(help, viewport)
                await page.screenshot({ path: testInfo.outputPath('login-erro.png') })
                await help.click()
                await expect(page.getByRole('region', { name: 'Recuperação de acesso' })).toBeVisible()
            } else if (mode === 'documents') {
                const row = page.getByRole('region', { name: 'CNH (verso)', exact: true })
                await expect(row).toContainText('Motivo informado:')
                await row.getByLabel('Foto: CNH (verso)').setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('synthetic-image') })
                await expect(row.getByRole('alert')).toBeVisible()
                const retry = row.getByRole('button', { name: 'Tentar este envio novamente' })
                await visible(retry, viewport)
                await page.screenshot({ path: testInfo.outputPath('documento-erro.png') })
                await page.evaluate(() => { window.fixtureAccountFailure = false })
                await retry.click()
                await expect(row.getByRole('status')).toContainText('envio confirmado')
                await page.getByLabel('Número da CNH', { exact: true }).fill('123456789')
                await visible(page.getByRole('button', { name: 'Salvar CNH' }), viewport)
                await page.getByRole('button', { name: 'Salvar CNH' }).click()
                await expect(page.getByText('CNH: dados salvos e confirmados.')).toBeVisible()
                await page.getByLabel('Tipo de chave Pix').selectOption('email')
                await page.getByLabel('Chave Pix', { exact: true }).fill('synthetic@example.test')
                await visible(page.getByRole('button', { name: 'Salvar PIX' }), viewport)
                await page.getByRole('button', { name: 'Salvar PIX' }).click()
                await expect(page.getByText('Pix: dados salvos e confirmados.')).toBeVisible()
                await page.screenshot({ path: testInfo.outputPath('formularios.png') })
            } else if (mode === 'help') {
                await page.getByRole('combobox', { name: 'Assunto', exact: true }).selectOption('documents')
                await page.getByLabel('Descreva o problema (opcional)').fill('Minha foto foi rejeitada no teste.')
                await expect(page.getByLabel('Mensagem que será aberta')).toHaveValue(/Minha foto foi rejeitada no teste./)
                await visible(page.getByRole('link', { name: 'Abrir WhatsApp do suporte' }), viewport)
                await visible(page.getByRole('link', { name: 'Abrir e-mail do suporte' }), viewport)
                await page.screenshot({ path: testInfo.outputPath('suporte.png') })
            } else {
                await expect(page.getByRole('heading', { name: 'Cadastro em análise' })).toBeVisible()
                await visible(page.getByRole('button', { name: 'Ver documentos e pendências' }), viewport)
                await visible(page.getByRole('button', { name: 'Falar com o suporte' }), viewport)
                await page.screenshot({ path: testInfo.outputPath('aprovacao.png') })
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        })
    }
}
