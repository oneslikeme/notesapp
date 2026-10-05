import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Inkwell',
        short_name: 'Inkwell',
        description: 'Notes, canvases, PDFs and research — offline, private, fast.',
        theme_color: '#fbfbfa',
        background_color: '#fbfbfa',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
        shortcuts: [
          { name: 'Quick capture', url: '/?action=capture', icons: [{ src: 'icon.svg', sizes: 'any' }] },
          { name: 'New page', url: '/?action=new', icons: [{ src: 'icon.svg', sizes: 'any' }] },
          { name: 'Search', url: '/#/search', icons: [{ src: 'icon.svg', sizes: 'any' }] },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2,wasm,bcmap,pfb,ttf,icc}'],
      },
    }),
  ],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2500 },
});
