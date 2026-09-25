import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('default Vitest discovery', () => {
  it('keeps local fixture integrations discoverable and omits only the PostgreSQL gate files', () => {
    const vitest = resolve(process.cwd(), 'node_modules/.bin/vitest');
    const result = spawnSync(
      vitest,
      [
        'list',
        '--files-only',
        '--config',
        'vitest.config.ts',
        'apps/api/src/modules/database/databasePiiGrantLifecycle.integration.test.ts',
        'apps/web/src/server/beszel/client.integration.test.ts',
        'apps/api/src/modules/database/databaseAudit.integration.test.ts',
        'apps/sql-worker/src/security/databaseExplorerPostgres.integration.test.ts',
        'apps/api/src/modules/database/databaseExplorerPostgres.integration.test.ts'
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'apps/api/src/modules/database/databasePiiGrantLifecycle.integration.test.ts'
    );
    expect(result.stdout).toContain('apps/web/src/server/beszel/client.integration.test.ts');
    expect(result.stdout).toContain(
      'apps/api/src/modules/database/databaseAudit.integration.test.ts'
    );
    expect(result.stdout).not.toContain(
      'apps/sql-worker/src/security/databaseExplorerPostgres.integration.test.ts'
    );
    expect(result.stdout).not.toContain(
      'apps/api/src/modules/database/databaseExplorerPostgres.integration.test.ts'
    );
  });
});
