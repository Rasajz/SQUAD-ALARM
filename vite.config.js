import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      },
      manifest: {
        id: '/?source=pwa',
        name: 'Squad Alarm',
        short_name: 'SquadAlarm',
        description: 'Real-time emergency alert and team messaging',
        theme_color: '#dc2626',
        background_color: '#07090d',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        screenshots: [
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Squad Alarm Web App'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Squad Alarm Mobile'
          }
        ]
      }
    })
  ],
  server: {
    port: 8080
  },
  define: {
    global: 'window',
    'process.env': {}
  },
  resolve: {
    alias: {
      process: 'process/browser',
      stream: 'stream-browserify',
      zlib: 'browserify-zlib',
      util: 'util',
      events: 'events'
    }
  }
})
