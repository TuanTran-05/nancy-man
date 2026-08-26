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

  it('refuses a DML preview while mutation rollout is disabled', async () => {
    const handler = createSqlWorkerCommandHandler({
      read: { enabled: false },
      mutation: { enabled: false }
    });

    await expect(
      handler(
        command({
          kind: 'sql.previewMutation',
          payload: {
            executionId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
            executionKey: 'SQL-20260822-preview',
            reason: 'Correct incorrect data.',
            sql: 'DELETE FROM public.students WHERE id = 1'
          }
        })
      )
    ).rejects.toMatchObject({ code: 'SQL_MUTATION_DISABLED' });
  });

  it('passes signed actor context and a validated preview request only to an enabled mutation worker', async () => {
    const requests: unknown[] = [];
    const handler = createSqlWorkerCommandHandler({
      read: { enabled: false },
      mutation: {
        enabled: true,
        preview: async (input) => {
          requests.push(input);
          return { affectedRows: 1, changes: [], truncated: false };
        }
      }
    });

    await expect(
      handler(
        command({
          kind: 'sql.previewMutation',
          payload: {
            executionId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
            executionKey: 'SQL-20260822-preview',
            reason: 'Correct incorrect data.',
            sql: 'DELETE FROM public.students WHERE id = 1',
            maxChanges: 100
          }
        })
      )
    ).resolves.toEqual({ affectedRows: 1, changes: [], truncated: false });
    expect(requests).toEqual([
      {
        executionId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
        executionKey: 'SQL-20260822-preview',
        actorUserId: 'usr_1',
        actorSessionId: 'ses_1',
        reason: 'Correct incorrect data.',
        sql: 'DELETE FROM public.students WHERE id = 1',
        maxChanges: 100
      }
    ]);
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
