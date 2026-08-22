import { describe, expect, it } from 'vitest';

import type { WorkerCommand } from '../../../../packages/contracts/src/workerProtocol.js';

import { createSqlWorkerCommandHandler } from './commandHandler.js';

const actor = { userId: 'usr_1', sessionId: 'ses_1', role: 'ops_maintainer' as const };

function command(input: Pick<WorkerCommand, 'kind' | 'payload'>): WorkerCommand {
  return {
    protocolVersion: 1,
    commandId: 'cmd_1',
    issuedAt: '2026-08-22T10:00:00.000Z',
    nonce: 'nonce_1',
    actor,
    ...input,
    signature: 'signature'
  };
}

describe('createSqlWorkerCommandHandler', () => {
  it('classifies a read query without opening a production database connection', async () => {
    const handler = createSqlWorkerCommandHandler({ read: { enabled: false } });

    await expect(
      handler(command({ kind: 'sql.classify', payload: { sql: 'SELECT id FROM students' } }))
    ).resolves.toEqual({ allowed: true, kind: 'select' });
  });

  it('classifies DML without opening a production write connection', async () => {
    const handler = createSqlWorkerCommandHandler({ read: { enabled: false } });

    await expect(
      handler(
        command({
          kind: 'sql.classifyMutation',
          payload: { sql: "UPDATE public.students SET name = 'An' WHERE id = '1'" }
        })
      )
    ).resolves.toEqual({ allowed: true, kind: 'update', requiresTypedConfirmation: false });
  });

  it('refuses a read preview while the read-only rollout flag is disabled', async () => {
    const handler = createSqlWorkerCommandHandler({ read: { enabled: false } });

    await expect(
      handler(command({ kind: 'sql.previewRead', payload: { sql: 'SELECT id FROM students' } }))
    ).rejects.toMatchObject({ code: 'SQL_READ_DISABLED' });
  });

  it('executes a bounded preview through the worker-owned read connection only', async () => {
    const previews: Array<{ sql: string; maxRows?: number }> = [];
    const handler = createSqlWorkerCommandHandler({
      read: {
        enabled: true,
        preview: async (input) => {
          previews.push(input);
          return { rows: [{ id: 1 }], truncated: true };
        }
      }
    });

    await expect(
      handler(
        command({
          kind: 'sql.previewRead',
          payload: { sql: 'SELECT id FROM students', maxRows: 1 }
        })
      )
    ).resolves.toEqual({ rows: [{ id: 1 }], truncated: true });
    expect(previews).toEqual([{ sql: 'SELECT id FROM students', maxRows: 1 }]);
  });

  it('returns a structural schema snapshot only through the enabled read worker', async () => {
    const snapshot = { checksum: 'a'.repeat(64), schemas: [] };
    const handler = createSqlWorkerCommandHandler({
      read: {
        enabled: true,
        preview: async () => ({ rows: [], truncated: false }),
        schema: async () => snapshot
      }
    });

    await expect(handler(command({ kind: 'schema.read', payload: {} }))).resolves.toBe(snapshot);
  });
});
