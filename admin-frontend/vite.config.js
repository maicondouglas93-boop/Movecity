import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setupTests.js',
    // Fase 2 (H4, 2026-08-05): specs do Playwright (e2e/ e tests/e2e/) não são do
    // Vitest — rodá-los aqui derrubava a suíte unitária sempre.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'tests/e2e/**'],
  },
})
