import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Wattson Navigator',
        short_name: 'Wattson Nav',
        description: 'Turn-by-turn navigation for electric unicycles with automatic charge pitstops.',
        theme_color: '#121316',
        background_color: '#121316',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-shell + static asset caching only. Deliberately NOT caching ORS/NLR/
        // OCM/Overpass API responses here — those go through our own IndexedDB
        // cache (see lib/db) with domain-appropriate TTLs, not a blanket service
        // worker cache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            // OpenFreeMap vector tiles — safe to cache aggressively, tiles don't
            // change underneath a given URL.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
})
