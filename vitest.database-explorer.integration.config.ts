import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/sql-worker/src/security/databaseExplorerPostgres.integration.test.ts',
      'apps/api/src/modules/database/databaseAudit.integration.test.ts',
      'apps/api/src/modules/database/databaseExplorerPostgres.integration.test.ts'
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
