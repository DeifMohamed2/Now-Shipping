import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/shopify-app/',
  build: {
    outDir: '../public/shopify-app',
    emptyOutDir: true,
    // Polaris ships CSS with custom media queries; esbuild/lightningcss minifiers reject `and print` after them.
    cssMinify: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
