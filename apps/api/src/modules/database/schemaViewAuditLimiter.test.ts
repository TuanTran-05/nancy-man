import { describe, expect, it } from 'vitest';

import { DatabaseExplorerService } from './databaseExplorerService.js';
import type { StepUpService } from '../auth/stepUpService.js';
import type { SqlWorkerActor } from '../../../../../packages/contracts/src/workerProtocol.js';

describe('schema view audit limiting', () => {
  it('deduplicates actor/target/checksum for 60 seconds and opens at the boundary or on checksum change', async () => {
    const actor: SqlWorkerActor = {
      userId: 'user-1',
      sessionId: 'session-1',
      role: 'ops_viewer'
    };
    const auditChecksums: string[] = [];
    let now = new Date('2026-09-25T12:00:00.000Z');
    let checksum = 'a'.repeat(64);
    const service = new DatabaseExplorerService({
      worker: {
        command: async () => ({
          protocolVersion: 1,
          commandId: 'schema-command',
          ok: true,
          result: {
            targetId: 'edutrack_production',
            targetLabel: 'EduTrack Production',
            checksum,
            policyVersion: '2026-09-25',
            schemas: [],
            edges: []
          }
        })
      },
      audit: {
        append: async (input) => {
          auditChecksums.push(String(input.metadata['schemaChecksum']));
          return { id: 'audit-id', entryHash: 'audit-hash' };
        }
      },
      stepUp: {} as StepUpService,
      findUserTotpFactorId: async () => null,
      now: () => now
    } as never);
    const input = { actor, targetId: 'edutrack_production' as const };

    await service.getSchema(input);
    await service.getSchema(input);
    expect(auditChecksums).toEqual(['a'.repeat(64)]);

    now = new Date('2026-09-25T12:01:00.000Z');
    await service.getSchema(input);
    expect(auditChecksums).toEqual(['a'.repeat(64), 'a'.repeat(64)]);

    checksum = 'b'.repeat(64);
    await service.getSchema(input);
    expect(auditChecksums).toEqual(['a'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)]);
  });

  it('fails closed when the required schema audit append is unavailable', async () => {
    const service = new DatabaseExplorerService({
      worker: {
        command: async () => ({
          protocolVersion: 1,
          commandId: 'schema-command',
          ok: true,
          result: {
            targetId: 'edutrack_production',
            targetLabel: 'EduTrack Production',
            checksum: 'a'.repeat(64),
            policyVersion: '2026-09-25',
            schemas: [],
            edges: []
          }
        })
      },
      audit: {
        append: async () => {
          throw new Error('audit unavailable');
        }
      },
      stepUp: {} as StepUpService,
      findUserTotpFactorId: async () => null
    } as never);

    await expect(
      service.getSchema({
        actor: { userId: 'user-1', sessionId: 'session-1', role: 'ops_viewer' },
        targetId: 'edutrack_production'
      })
    ).rejects.toMatchObject({ code: 'DATABASE_AUDIT_UNAVAILABLE', status: 503 });
  });
});
