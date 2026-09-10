import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readOpsBrowserTelemetryConfig } from './src/web/telemetry/config.js';

export function validateProductionBrowserTelemetryBuild(
  command: 'build' | 'serve',
  mode: string,
  environment: Record<string, string | boolean | undefined>
): void {
  if (command === 'build' && mode === 'production') {
    readOpsBrowserTelemetryConfig(environment, true);
  }
}

export default defineConfig(({ command, mode }) => {
  const environment = {
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env
  };
  validateProductionBrowserTelemetryBuild(command, mode, environment);
  return {
    plugins: [react()],
    build: {
      outDir: 'dist/web',
      emptyOutDir: true,
      rollupOptions: {
        input: 'index.html'
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'e2e/**/*.test.ts'],
      setupFiles: ['src/web/test-setup.ts']
    }
  };
});
