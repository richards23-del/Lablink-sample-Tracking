import 'dotenv/config';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: { outDir: 'dist/public', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.FRONTEND_PORT ?? 5173),
    strictPort: true,
    // Temporary review links created by localtunnel use a subdomain of loca.lt.
    allowedHosts: ['.loca.lt'],
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3001}` },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
