import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'apps/web/e2e/**/*.spec.ts',
      'apps/sql-worker/src/security/databaseExplorerPostgres.integration.test.ts',
      'apps/api/src/modules/database/databaseExplorerPostgres.integration.test.ts',
      '.worktrees/**'
    ],
    setupFiles: ['apps/web/src/web/test-setup.ts']
  }
});
