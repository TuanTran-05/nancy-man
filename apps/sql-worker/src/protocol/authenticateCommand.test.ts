import { describe, expect, it } from 'vitest';
import { authenticateWorkerCommand, signWorkerCommand } from './authenticateCommand.js';
describe('authenticateWorkerCommand', () => {
  it('rejects tamper, expiry and nonce replay', async () => {
    const base = {
      protocolVersion: 1 as const,
      commandId: 'cmd',
      issuedAt: '2026-08-22T03:14:00.000Z',
      nonce: 'nonce',
      actor: { userId: 'u', sessionId: 's', role: 'ops_maintainer' as const },
      kind: 'sql.classify' as const,
      payload: { sql: 'select 1' }
    };
    const command = { ...base, signature: signWorkerCommand(base, 'secret') };
    let used = false;
    expect(
      await authenticateWorkerCommand({
        command,
        secret: 'secret',
        now: new Date(base.issuedAt),
        consumeNonce: async () => {
          if (used) return false;
          used = true;
          return true;
        }
      })
    ).toBe(true);
    expect(
      await authenticateWorkerCommand({
        command,
        secret: 'secret',
        now: new Date(base.issuedAt),
        consumeNonce: async () => false
      })
    ).toBe(false);
    expect(
      await authenticateWorkerCommand({
        command: { ...command, payload: {} },
        secret: 'secret',
        now: new Date(base.issuedAt),
        consumeNonce: async () => true
      })
    ).toBe(false);
  });

  it('permits a viewer only for a signed schema-read command', async () => {
    const base = {
      protocolVersion: 1 as const,
      commandId: 'cmd-schema',
      issuedAt: '2026-08-22T03:14:00.000Z',
      nonce: 'viewer-nonce',
      actor: { userId: 'viewer', sessionId: 'session', role: 'ops_viewer' as const },
      kind: 'schema.read' as const,
      payload: {}
    };
    const command = { ...base, signature: signWorkerCommand(base, 'secret') };
    expect(
      await authenticateWorkerCommand({
        command,
        secret: 'secret',
        now: new Date(base.issuedAt),
        consumeNonce: async () => true
      })
    ).toBe(true);
    const classify = { ...base, kind: 'sql.classify' as const };
    const signedClassify = { ...classify, signature: signWorkerCommand(classify, 'secret') };
    expect(
      await authenticateWorkerCommand({
        command: signedClassify,
        secret: 'secret',
        now: new Date(base.issuedAt),
        consumeNonce: async () => true
      })
    ).toBe(false);
  });
});
