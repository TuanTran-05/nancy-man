import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startWorkerProtocolServer } from '../../../../sql-worker/src/protocol/server.js';
import { SqlWorkerClient } from './workerClient.js';
describe('SqlWorkerClient', () => {
  it('sends an authenticated read command only over a Unix socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-api-'));
    const socketPath = join(directory, 'worker.sock');
    const server = await startWorkerProtocolServer({
      path: socketPath,
      secret: 'secret',
      consumeNonce: async () => true,
      handle: async (command) => ({ kind: command.kind })
    });
    try {
      const client = new SqlWorkerClient({ socketPath, secret: 'secret' });
      await expect(
        client.command({
          actor: { userId: 'u', sessionId: 's', role: 'ops_maintainer' },
          kind: 'sql.classify',
          payload: { sql: 'SELECT 1' }
        })
      ).resolves.toMatchObject({ ok: true, result: { kind: 'sql.classify' } });
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
