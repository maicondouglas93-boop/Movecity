import { defineConfig } from '@playwright/test'

// Servidor isolado inclusive no CI: fixtures importam componentes reais sem
// incluir entradas de teste no build publicado e sem usar sessão do motorista.
export default defineConfig({
    testDir: './e2e-driver-shell',
    testMatch: ['driverShell.spec.js', 'driverHome.spec.js'],
    workers: 1,
    reporter: 'list',
    use: { baseURL: 'http://127.0.0.1:5181', browserName: 'chromium', headless: true },
    webServer: {
        command: 'npm run dev -- --mode driver --host 127.0.0.1 --port 5181 --strictPort',
        url: 'http://127.0.0.1:5181',
        reuseExistingServer: false,
        timeout: 60000,
    },
})
