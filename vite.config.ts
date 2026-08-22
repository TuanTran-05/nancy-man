import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/.env', '**/.env.*'],
      },
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (
                id.includes('/react-dom') ||
                id.includes('/react/') ||
                id.includes('/react-router')
              )
                return 'vendor-react';
              if (id.includes('/recharts')) return 'vendor-charts';
              if (id.includes('/framer-motion')) return 'vendor-motion';
              if (id.includes('/jspdf')) return 'vendor-pdf';
              if (id.includes('/docx') || id.includes('/file-saver')) return 'vendor-docx';
              if (id.includes('/lucide-react')) return 'vendor-icons';
            }
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'node',
      testTimeout: 15_000,
      include: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'shared/**/*.test.ts',
        'api/**/*.test.ts',
        'server/**/*.test.ts',
        'deploy/**/*.test.ts',
        'scripts/**/*.test.ts',
        'scripts/**/*.test.mjs',
        // Shared test utilities have their own suite and must stay included.
        'test-utils/**/*.test.ts',
        'realtime/**/*.test.mjs',
        '*.test.ts',
        '*.test.mjs',
      ],
      environmentMatchGlobs: [
        ['src/components/**', 'jsdom'],
        ['src/hooks/**', 'jsdom'],
        ['src/pages/**', 'jsdom'],
      ],
      setupFiles: ['./src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/lib/**', 'server/api/lib/**', 'server/api/auth/**', 'api/auth/**'],
      },
    },
  };
});
