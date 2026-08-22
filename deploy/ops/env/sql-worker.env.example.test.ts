import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const artifact = new URL('./sql-worker.env.example', import.meta.url);

describe('SQL worker production-safe defaults', () => {
  it('keeps all write capability disabled in the checked-in worker environment', async () => {
    const environment = await readFile(artifact, 'utf8');

    expect(environment).toContain('OPS_SQL_MUTATION_ENABLED=false');
    expect(environment).not.toContain('OPS_PRODUCTION_MUTATION_DATABASE_URL=');
  });
});
