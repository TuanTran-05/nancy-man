import { mkdtempSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  AgentResponseSchema,
  encodeFrame,
  type AgentRequestEnvelope
} from '../../../../packages/config-contracts/src/index.js';
import { createFingerprintKey } from '../inventory/fingerprint.js';
import {
  createAuthenticatedServer,
  signAgentRequest,
  type AuthenticatedServer
} from './authenticatedServer.js';

const actor = {
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
  role: 'ops_owner' as const,
  ipHash: `sha256:${'1'.repeat(64)}`,
  userAgentHash: `sha256:${'2'.repeat(64)}`
};

const loaded = {
  catalog: {
    catalogVersion: '2026-08-31',
    apps: [],
    entries: [],
    validators: [],
    consumers: [],
    precedences: []
  },
  manifest: {
    manifestVersion: '2026-08-31',
    catalogVersion: '2026-08-31',
    catalogDigest: `sha256:${'a'.repeat(64)}`,
    readOnly: true,
    apps: [],
    sources: [],
    actions: [],
    checks: []
  },
  catalogDigest: `sha256:${'a'.repeat(64)}`
} as const;

function request(overrides: Partial<AgentRequestEnvelope> = {}): AgentRequestEnvelope {
  const base = {
    version: 1 as const,
    requestId: 'REQ_20260831_001',
    issuedAt: '2026-08-31T13:10:00.000Z',
    expiresAt: '2026-08-31T13:10:30.000Z',
    actor,
    operation: 'agent.capabilities' as const,
    body: {},
    hmacKeyId: 'config-agent-protocol-v1'
  };
  return signAgentRequest({ ...base, ...overrides }, 'protocol-secret');
}

async function start(): Promise<{ server: AuthenticatedServer; socketPath: string }> {
  const root = mkdtempSync(join(tmpdir(), 'edutrack-config-agent-protocol-'));
  const socketPath = join(root, 'agent.sock');
  const server = createAuthenticatedServer({
    socketPath,
    socketGroupId: typeof process.getgid === 'function' ? process.getgid() : undefined,
    protocolKey: 'protocol-secret',
    protocolKeyId: 'config-agent-protocol-v1',
    fingerprintKey: createFingerprintKey('fingerprint-secret', 'v1'),
    loaded,
    now: () => new Date('2026-08-31T13:10:05.000Z'),
    inventoryService: {
      read: async () => ({
        catalogVersion: '2026-08-31',
        manifestVersion: '2026-08-31',
        generatedAt: '2026-08-31T13:10:05.000Z',
        items: []
      })
    }
  });
  await server.start();
  return { server, socketPath };
}

async function exchange(socketPath: string, value: unknown): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.createConnection(socketPath);
    socket.on('connect', () => socket.write(encodeFrame(value)));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks)));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET') resolve(Buffer.concat(chunks));
      else reject(error);
    });
  });
}

describe('authenticated Config Agent server', () => {
  test('serves capabilities and inventory over a mode-0660 Unix socket', async () => {
    const { server, socketPath } = await start();
    try {
      expect(readFileSync(socketPath)).toEqual(Buffer.alloc(0));
    } catch (error) {
      expect(['EISDIR', 'ENXIO']).toContain((error as NodeJS.ErrnoException).code);
    }
    const stat = await import('node:fs').then(({ statSync }) => statSync(socketPath));
    expect(stat.mode & 0o777).toBe(0o660);

    const response = AgentResponseSchema.parse(
      JSON.parse((await exchange(socketPath, request())).subarray(4).toString('utf8'))
    );
    expect(response).toMatchObject({
      ok: true,
      operation: 'agent.capabilities',
      body: {
        protocolVersion: 1,
        readOnly: true,
        supportedOperations: ['inventory.read'],
        maximumFrameBytes: 1_048_576
      }
    });
    await server.close();
  });

  test.each([
    ['wrong key id', request({ hmacKeyId: 'other-key' })],
    ['bad HMAC', { ...request(), signature: `hmac-sha256:v1:${'f'.repeat(64)}` }],
    ['expired', request({ expiresAt: '2026-08-31T13:09:59.000Z' })],
    ['future issued-at', request({ issuedAt: '2026-08-31T13:11:10.000Z' })],
    ['unknown field', { ...request(), unknown: 'sentinel-value' }]
  ])('closes without serializing a body for %s', async (_label, value) => {
    const { server, socketPath } = await start();
    try {
      const bytes = await exchange(socketPath, value);
      expect(bytes.toString('utf8')).not.toContain('sentinel-value');
      expect(bytes).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  test('rejects replayed request ids, oversized frames, and multiple frames', async () => {
    const { server, socketPath } = await start();
    try {
      const first = await exchange(socketPath, request());
      expect(first.length).toBeGreaterThan(0);
      const replay = await exchange(socketPath, request());
      expect(replay).toHaveLength(0);

      const oversized = await new Promise<Buffer>((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        const payload = Buffer.alloc(1_048_577, 65);
        const frame = Buffer.alloc(4 + payload.length);
        frame.writeUInt32BE(payload.length, 0);
        payload.copy(frame, 4);
        socket.on('connect', () => socket.write(frame));
        const chunks: Buffer[] = [];
        socket.on('data', (chunk: Buffer) => chunks.push(chunk));
        socket.on('end', () => resolve(Buffer.concat(chunks)));
        socket.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'ECONNRESET') resolve(Buffer.concat(chunks));
          else reject(error);
        });
      });
      expect(oversized).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
