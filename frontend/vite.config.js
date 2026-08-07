import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const pwaPlugin = VitePWA({
  // prompt (não autoUpdate): o SW novo fica em waiting até o usuário confirmar.
  // Com autoUpdate, onNeedRefresh nunca disparava — o botão "Atualizar app" e o
  // banner mentiam "já atualizado" / não recarregavam o JS em memória (2026-08-04).
  registerType: 'prompt',
  injectRegister: false,
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg}'],
    // C1 da auditoria de push (2026-08-02): sem isto, o próprio Service Worker do
    // PWA fazia precache do firebase-messaging-sw.js como se fosse um asset comum,
    // arriscando servir uma cópia desatualizada dele após um deploy.
    globIgnores: ['**/firebase-messaging-sw.js'],
    cleanupOutdatedCaches: true,
    maximumFileSizeToCacheInBytes: 5000000,
    // Auditoria PWA (2026-08-03, M1): sem nenhum runtimeCaching, qualquer perda de
    // conexão fazia até uma leitura pública e não sensível (catálogo de veículos)
    // falhar com o erro genérico de rede — a categoria de veículo raramente muda e
    // não tem nada de privado nela, então serve bem de NetworkFirst com timeout
    // curto: tenta a rede, mas cai pro cache se demorar/falhar, em vez de quebrar a
    // tela de reserva. Nenhum outro endpoint entra aqui de propósito — dado de
    // corrida/usuário nunca deve ficar em Cache Storage.
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname === '/vehicle-categories',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'vehicle-categories-cache',
          networkTimeoutSeconds: 4,
          // Uma entrada por ?service= (ride, parcel, scheduledRide, scheduledParcel) + sem filtro
          expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 },
        },
      },
    ],
  },
  manifest: {
    name: 'MoveCity',
    short_name: 'MoveCity',
    description: 'MoveCity App',
    // Auditoria PWA (2026-08-03, M8): o resto do app já é pt-BR (index.html) — o
    // manifest gerado ficava com o default em inglês do plugin.
    lang: 'pt-BR',
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
    // Auditoria PWA (2026-08-03, B1): atalho de long-press no ícone (Android/desktop
    // instalado) direto pro fluxo de reserva do passageiro.
    shortcuts: [
      {
        name: 'Pedir corrida',
        short_name: 'Pedir corrida',
        url: '/home',
        icons: [{ src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    // Fase 3 da auditoria de production readiness (M4, 2026-08-05): o manifest usava
    // um único JPEG 1024px declarado como 192/512 — JPEG não tem transparência, o
    // navegador redimensionava na instalação e não existia variante maskable, então
    // Android adaptava o ícone cortando/emoldurando de qualquer jeito. PNGs reais nos
    // dois tamanhos + maskable com a arte na zona segura (gerados de movecity-icon.jpg
    // com sharp — ver docs no PR da fase 3).
    icons: [
      { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
  }
})

// CaptainHeader importa PwaUpdateContext (virtual:pwa-register/react). No build
// driver o plugin PWA fica desligado — este stub resolve o virtual sem registrar SW.
const stubPwaRegisterPlugin = {
  name: 'stub-pwa-register-driver',
  resolveId(id) {
    if (id === 'virtual:pwa-register/react') return id
    return undefined
  },
  load(id) {
    if (id !== 'virtual:pwa-register/react') return undefined
    return `
      export function useRegisterSW() {
        return {
          needRefresh: [false, () => {}],
          offlineReady: [false, () => {}],
          updateServiceWorker: async () => {},
        }
      }
    `
  },
}

// Capacitor espera index.html em webDir; a entrada de fonte continua sendo driver.html.
const copyDriverHtmlAsIndexPlugin = {
  name: 'copy-driver-html-as-index',
  closeBundle() {
    const outDir = path.resolve(__dirname, 'dist-driver')
    const from = path.join(outDir, 'driver.html')
    const to = path.join(outDir, 'index.html')
    if (fs.existsSync(from)) fs.copyFileSync(from, to)
  },
}

// https://vite.dev/config/
// mode === 'driver': nova entrada (driver.html → dist-driver), sem PWA.
// mode default: app web completo (index.html → dist) com PWA — comportamento preservado.
export default defineConfig(({ mode }) => {
  const isDriver = mode === 'driver'

  return {
    // Capacitor carrega assets via file/capacitor scheme — base absoluto "/" quebra
    // o build do motorista. O app Web completo mantém "/" (deploy Vercel/PWA).
    base: isDriver ? './' : '/',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    plugins: [
      react(),
      ...(isDriver ? [stubPwaRegisterPlugin, copyDriverHtmlAsIndexPlugin] : [pwaPlugin]),
    ],
    build: isDriver
      ? {
          outDir: 'dist-driver',
          emptyOutDir: true,
          rollupOptions: {
            input: path.resolve(__dirname, 'driver.html'),
          },
        }
      : {
          // defaults Vite (outDir: dist, input: index.html)
        },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './vitest.setup.js',
      css: true,
      // Fase 2 da auditoria de production readiness (H4, 2026-08-05): o Vitest
      // varria e2e/ e tentava executar specs do Playwright (test.describe explode
      // fora do runner dele) — a suíte unitária nunca ficava verde. E2E roda por
      // `npm run test:e2e`, não aqui.
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    },
  }
})
