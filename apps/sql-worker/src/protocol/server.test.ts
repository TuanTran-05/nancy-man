import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signWorkerCommand } from './authenticateCommand.js';
import { encodeFrame, FrameDecoder } from './framing.js';
import { startWorkerProtocolServer } from './server.js';
describe('worker protocol server', () => {
  it('accepts an authenticated Unix-socket command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-worker-'));
    const path = join(directory, 'worker.sock');
    const server = await startWorkerProtocolServer({
      path,
      secret: 'secret',
      consumeNonce: async () => true,
      handle: async () => ({ ok: 'handled' })
    });
    const unsigned = {
      protocolVersion: 1 as const,
      commandId: 'cmd',
      issuedAt: new Date().toISOString(),
      nonce: 'nonce',
      actor: { userId: 'u', sessionId: 's', role: 'ops_maintainer' as const },
      kind: 'sql.classify' as const,
      payload: {}
    };
    const command = { ...unsigned, signature: signWorkerCommand(unsigned, 'secret') };
    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const socket = createConnection(path);
        const decoder = new FrameDecoder();
        socket.on('connect', () => socket.write(encodeFrame(command)));
        socket.on('data', (chunk) => {
          const [value] = decoder.push(chunk);
          if (value) {
            socket.end();
            resolve(value);
          }
        });
        socket.on('error', reject);
      });
      expect(response).toMatchObject({ ok: true, commandId: 'cmd', result: { ok: 'handled' } });
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
