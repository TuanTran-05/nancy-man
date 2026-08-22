import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('refuses to replace a non-socket path when binding the private listener', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-worker-'));
    const path = join(directory, 'worker.sock');
    await writeFile(path, 'do-not-delete', 'utf8');

    try {
      await expect(
        startWorkerProtocolServer({
          path,
          secret: 'secret',
          consumeNonce: async () => true,
          handle: async () => ({ ok: 'handled' })
        })
      ).rejects.toThrow(/socket path/i);
      await expect(readFile(path, 'utf8')).resolves.toBe('do-not-delete');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a signed command that claims a non-privileged actor role', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-worker-'));
    const path = join(directory, 'worker.sock');
    let handled = false;
    const server = await startWorkerProtocolServer({
      path,
      secret: 'secret',
      consumeNonce: async () => true,
      handle: async () => {
        handled = true;
        return { ok: 'handled' };
      }
    });
    const unsigned = {
      protocolVersion: 1 as const,
      commandId: 'cmd',
      issuedAt: new Date().toISOString(),
      nonce: 'nonce',
      actor: { userId: 'u', sessionId: 's', role: 'ops_viewer' },
      kind: 'sql.classify' as const,
      payload: {}
    };
    const command = { ...unsigned, signature: signWorkerCommand(unsigned as never, 'secret') };

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
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'WORKER_COMMAND_DENIED' }
      });
      expect(handled).toBe(false);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns a sanitized command failure without exposing an internal error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ops-worker-'));
    const path = join(directory, 'worker.sock');
    const server = await startWorkerProtocolServer({
      path,
      secret: 'secret',
      consumeNonce: async () => true,
      handle: async () => {
        const error = new Error('database hostname and credential details');
        Object.assign(error, { code: 'SQL_READ_DISABLED' });
        throw error;
      }
    });
    const unsigned = {
      protocolVersion: 1 as const,
      commandId: 'cmd',
      issuedAt: new Date().toISOString(),
      nonce: 'nonce',
      actor: { userId: 'u', sessionId: 's', role: 'ops_maintainer' as const },
      kind: 'sql.previewRead' as const,
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
      expect(response).toEqual({
        protocolVersion: 1,
        commandId: 'cmd',
        ok: false,
        error: { code: 'SQL_READ_DISABLED', safeMessage: 'Command could not be processed' }
      });
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
