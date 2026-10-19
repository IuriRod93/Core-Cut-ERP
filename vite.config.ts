import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const apiTarget = process.env.ARCOPLAN_API_URL ?? 'http://127.0.0.1:4400'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['core-cut-logo.png'],
      // O service worker NÃO pré-carrega os .js: eles são entregues só a quem tem sessão e a lista de arquivos
      // do aplicativo não deve ficar publicada em sw.js.
      workbox: { globPatterns: ['**/*.{html,css,ico,png,svg,woff2,webmanifest}'], globIgnores: ['site/**', 'downloads/**'] },
      manifest: {
        name: 'Core Cut ERP',
        short_name: 'Core Cut',
        description: 'Gestão integrada para marcenaria industrial.',
        lang: 'pt-BR',
        theme_color: '#13232b',
        background_color: '#f8f7f5',
        display: 'standalone',
        start_url: '/painel',
        icons: [
          {
            src: '/core-cut-logo.png',
            sizes: '612x612',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  server: {
    host: process.env.VITE_HOST ?? '0.0.0.0',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    // Túneis HTTPS gratuitos (enquanto não há domínio próprio): cloudflared / ngrok.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 1200 },
})
