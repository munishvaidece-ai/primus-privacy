/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

// `vite build --mode artifact` produces ONE self-contained HTML page (all JS/CSS inlined, no public assets)
// for a sandboxed viewer; scripts/make_artifact.mjs then reshapes it into the publishable page.
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    plugins: [react(), ...(artifact ? [viteSingleFile()] : [])],
    base: artifact ? './' : '/',
    publicDir: artifact ? false : 'public',
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: { host: '127.0.0.1', port: 5173 },
    build: artifact
      ? { outDir: 'dist-artifact', emptyOutDir: true, chunkSizeWarningLimit: 6000, cssCodeSplit: false, assetsInlineLimit: 100_000_000 }
      : {
          chunkSizeWarningLimit: 900,
          rollupOptions: {
            output: {
              manualChunks: {
                charts: ['recharts'],
                react: ['react', 'react-dom', 'react-router-dom'],
              },
            },
          },
        },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
