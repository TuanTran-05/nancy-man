import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const artifact = new URL('./sql-worker.env.example', import.meta.url);

describe('SQL worker production-safe defaults', () => {
  it('keeps all write capability disabled in the checked-in worker environment', async () => {
    const environment = await readFile(artifact, 'utf8');

    expect(environment).toContain('OPS_SQL_MUTATION_ENABLED=false');
    expect(environment).toContain('OPS_DATABASE_EXPLORER_ENABLED=false');
    expect(environment).toContain('OPS_DATABASE_EDUTRACK_ENABLED=false');
    expect(environment).toContain('OPS_DATABASE_OPS_ENABLED=false');
    expect(environment).not.toContain('OPS_PRODUCTION_MUTATION_DATABASE_URL=');
    expect(environment).not.toContain('OPS_DATABASE_EDUTRACK_URL=');
    expect(environment).not.toContain('OPS_DATABASE_OPS_URL=');
    expect(environment).not.toContain('OPS_DATABASE_CURSOR_KEY=');
    expect(environment).not.toMatch(/postgres(?:ql)?:\/\//i);
  });

  it('uses the two LOGIN identities as expected roles and keeps every rollout gate false', async () => {
    const environment = await readFile(artifact, 'utf8');
    const entries = new Map(
      environment
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
    );

    expect(entries.get('OPS_DATABASE_EDUTRACK_ROLE')).toBe('ops_browser_edutrack');
    expect(entries.get('OPS_DATABASE_OPS_ROLE')).toBe('ops_browser_ops');
    expect(entries.get('OPS_DATABASE_EDUTRACK_ROLE')).not.toBe('ops_database_browser');
    expect(entries.get('OPS_DATABASE_OPS_ROLE')).not.toBe('ops_database_browser');

    for (const [name, value] of entries) {
      if (
        /^OPS_(?:SQL_(?:WORKER|READ|MUTATION|DDL|BREAK_GLASS)|DATABASE_(?:EXPLORER|EDUTRACK|OPS))_ENABLED$/u.test(
          name
        )
      ) {
        expect(value, `${name} must stay dark in the example`).toBe('false');
      }
    }
  });
});
