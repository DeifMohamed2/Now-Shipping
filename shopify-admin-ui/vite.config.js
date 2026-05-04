import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/shopify-app/',
  build: {
    outDir: '../public/shopify-app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
