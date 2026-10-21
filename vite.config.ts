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
      workbox: {
        // A página (index.html) NÃO entra no pré-cache: a cópia guardada levaria junto os cabeçalhos da época
        // (Permissions-Policy, CSP) e, como o HTML quase não muda, nunca seria atualizada.
        globPatterns: ['**/*.{css,ico,png,svg,woff2,webmanifest}'],
        globIgnores: ['site/**', 'downloads/**'],
        navigateFallback: null,
        // Para o chão de fábrica abrir sem internet. Nada é pré-carregado: guarda só o que o usuário
        // logado já baixou, e os caches de dados são apagados no login e no logout (src/lib/offlineCache.ts).
        runtimeCaching: [
          {
            // páginas: sempre da rede (cabeçalhos atuais); sem internet, a última cópia da casca do app
            urlPattern: ({ request, url, sameOrigin }) => sameOrigin && request.mode === 'navigate' && !/^\/(api|site|downloads)\//.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'corecut-pages',
              networkTimeoutSeconds: 8,
              cacheableResponse: { statuses: [200] },
              // todas as rotas do app são o mesmo index.html: uma única cópia
              plugins: [{ cacheKeyWillBeUsed: async () => '/index.html' }],
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js'),
            handler: 'CacheFirst',
            options: { cacheName: 'corecut-app-code', cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 250, maxAgeSeconds: 30 * 24 * 3600 } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/api\/(auth\/me|data\/(productionOrders|workCenters))$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'corecut-offline-data', networkTimeoutSeconds: 10, cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 10, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
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
