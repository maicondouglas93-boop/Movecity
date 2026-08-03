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
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg}'],
        // C1 da auditoria de push (2026-08-02): sem isto, o próprio Service Worker do
        // PWA fazia precache do firebase-messaging-sw.js como se fosse um asset comum,
        // arriscando servir uma cópia desatualizada dele após um deploy.
        globIgnores: ['**/firebase-messaging-sw.js'],
        maximumFileSizeToCacheInBytes: 5000000,
      },
      manifest: {
        name: 'MoveCity',
        short_name: 'MoveCity',
        description: 'MoveCity App',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
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
