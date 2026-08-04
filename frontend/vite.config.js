import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
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
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 },
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
            icons: [{ src: '/movecity-icon.jpg', sizes: '192x192', type: 'image/jpeg' }],
          },
        ],
        icons: [
          {
            src: '/movecity-icon.jpg', // Usando um ícone existente
            sizes: '192x192',
            type: 'image/jpeg'
          },
          {
            src: '/movecity-icon.jpg',
            sizes: '512x512',
            type: 'image/jpeg'
          }
        ]
      }
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.js',
    css: true,
  },
})
