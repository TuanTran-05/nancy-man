import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'apps/web/e2e/**/*.spec.ts'],
    setupFiles: ['apps/web/src/web/test-setup.ts']
  }
});
