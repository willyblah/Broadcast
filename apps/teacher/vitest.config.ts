import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_ADMIN_EMAIL': JSON.stringify('admin@broadcast.local'),
  },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'virtual:pwa-register/react': fileURLToPath(new URL('tests/pwa-stub.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000, hookTimeout: 30000 },
});
