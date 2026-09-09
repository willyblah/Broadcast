import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: '校园广播', short_name: '校园广播', lang: 'zh-CN',
      description: '向教室发送广播并查看接收与播放情况',
      start_url: '/', scope: '/', display: 'standalone',
      theme_color: '#2563eb', background_color: '#f5f7fa',
      icons: [192, 512].map(size => ({ src: '/icon-' + size + '.png', sizes: size + 'x' + size, type: 'image/png', purpose: 'any' })),
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], navigateFallback: '/index.html', cleanupOutdatedCaches: true },
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { usePolling: true } },
});
