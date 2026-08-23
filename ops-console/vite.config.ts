import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/web/main.tsx',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'deploy/**/*.test.ts'],
    setupFiles: ['src/web/test-setup.ts'],
  },
});
