import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';

import { encodeFrame, FrameDecoder } from '../../../../packages/config-contracts/src/framing.js';
import { describe, expect, it } from 'vitest';

import {
  ConfigAgentClient,
  ConfigAgentError,
  type ConfigAgentClientOptions,
  signAgentEnvelope
} from './configAgentClient.js';

const actor = {
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
  role: 'ops_owner' as const,
  ipHash: `sha256:${'1'.repeat(64)}`,
  userAgentHash: `sha256:${'2'.repeat(64)}`
};

const inventory = {
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  generatedAt: '2026-08-31T13:12:00.000Z',
  items: [
    {
      catalogId: 'edutrack.database_url',
      name: 'DATABASE_URL',
      value: 'test-secret-value',
      appId: 'edutrack-platform',
      appName: 'EduTrack Platform',
      functionIds: ['database'],
      sourceId: 'edutrack.shared_env',
      sourcePathLabel: '/srv/edutrack/shared/.env',
      sourceAdapter: 'node_env_file' as const,
      consumerIds: ['edutrack-web'],
      category: 'database' as const,
      description: 'Primary database',
      sensitivity: 'secret' as const,
      requirement: 'required' as const,
      mutability: 'managed' as const,
      applyStrategy: 'runtime_restart' as const,
      relatedDefinitionIds: [],
      precedence: { precedenceId: 'node_env_file', rank: 200, effective: true },
      sourceFingerprint: `hmac-sha256:v1:${'3'.repeat(64)}`,
      valueFingerprint: `hmac-sha256:v1:${'4'.repeat(64)}`
    }
  ]
};

const capabilities = {
  protocolVersion: 1 as const,
  readOnly: true as const,
  supportedOperations: ['inventory.read' as const],
  manifestVersion: '2026-08-31',
  catalogVersion: '2026-08-31',
  catalogDigest: `sha256:${'b'.repeat(64)}`,
  maximumFrameBytes: 1_048_576 as const
};

function options(socketPath: string, overrides: Partial<ConfigAgentClientOptions> = {}) {
  return {
    socketPath,
    hmacKey: 'agent-protocol-secret',
    hmacKeyId: 'config-agent-2026-08-31',
    now: () => new Date('2026-08-31T13:10:00.000Z'),
    requestId: () => 'REQ_20260831_001',
    connectTimeoutMs: 500,
    readTimeoutMs: 500,
    totalTimeoutMs: 1_000,
    maximumResponseBytes: 1_048_576,
    ...overrides
  } satisfies ConfigAgentClientOptions;
}

async function withSocket(
  handler: (request: Record<string, unknown>, socket: import('node:net').Socket) => void,
  action: (socketPath: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'ops-config-agent-client-'));
  const socketPath = join(directory, 'agent.sock');
  const decoder = new FrameDecoder();
  const server = createServer((socket) => {
    socket.on('data', (chunk) => {
      for (const value of decoder.push(chunk)) handler(value as Record<string, unknown>, socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  try {
    await action(socketPath);
  } finally {
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

function responseFor(
  request: Record<string, unknown>,
  body: Record<string, unknown>,
  key = 'agent-protocol-secret'
) {
  const response = {
    version: 1 as const,
    requestId: request.requestId,
    issuedAt: '2026-08-31T13:10:01.000Z',
    expiresAt: '2026-08-31T13:10:31.000Z',
    operation: request.operation,
    ok: true as const,
    body,
    hmacKeyId: 'config-agent-2026-08-31'
  };
  return { ...response, signature: signAgentEnvelope(response, key) };
}

describe('ConfigAgentClient', () => {
  it('signs framed inventory requests and validates the correlated HMAC response', async () => {
    await withSocket(
      (request, socket) => {
        expect(request.operation).toBe('inventory.read');
        expect(request.body).toEqual({ includeValues: true });
        expect(request.signature).toMatch(/^hmac-sha256:v1:[a-f0-9]{64}$/u);
        socket.end(encodeFrame(responseFor(request, inventory)));
      },
      async (socketPath) => {
        const client = new ConfigAgentClient(options(socketPath));
        await expect(client.readInventory(actor)).resolves.toMatchObject({
          items: inventory.items
        });
      }
    );
  });

  it('negotiates read-only capabilities against the expected deployment contract', async () => {
    await withSocket(
      (request, socket) => {
        socket.end(encodeFrame(responseFor(request, capabilities)));
      },
      async (socketPath) => {
        const client = new ConfigAgentClient(options(socketPath));
        await expect(
          client.negotiate({
            manifestVersion: '2026-08-31',
            catalogVersion: '2026-08-31',
            catalogDigest: `sha256:${'b'.repeat(64)}`
          })
        ).resolves.toEqual(capabilities);
      }
    );
  });

  it('rejects an otherwise compatible agent that is not read-only', async () => {
    await withSocket(
      (request, socket) => {
        socket.end(encodeFrame(responseFor(request, { ...capabilities, readOnly: false })));
      },
      async (socketPath) => {
        const client = new ConfigAgentClient(options(socketPath));
        await expect(
          client.negotiate({
            manifestVersion: '2026-08-31',
            catalogVersion: '2026-08-31',
            catalogDigest: `sha256:${'b'.repeat(64)}`
          })
        ).rejects.toMatchObject({ code: 'CONFIG_AGENT_INCOMPATIBLE' });
      }
    );
  });

  it('binds subsequent inventory responses to the negotiated versions and rejects future timestamps', async () => {
    let capabilitiesRequest = true;
    await withSocket(
      (request, socket) => {
        if (capabilitiesRequest) {
          capabilitiesRequest = false;
          socket.end(encodeFrame(responseFor(request, capabilities)));
          return;
        }
        socket.end(
          encodeFrame(
            responseFor(request, {
              ...inventory,
              catalogVersion: '2026-09-01'
            })
          )
        );
      },
      async (socketPath) => {
        const client = new ConfigAgentClient(options(socketPath));
        await client.negotiate({
          manifestVersion: '2026-08-31',
          catalogVersion: '2026-08-31',
          catalogDigest: `sha256:${'b'.repeat(64)}`
        });
        await expect(client.readInventory(actor)).rejects.toMatchObject({
          code: 'AGENT_RESPONSE_MISMATCH'
        });
      }
    );

    await withSocket(
      (request, socket) => {
        const response = responseFor(request, inventory);
        const future = {
          ...response,
          issuedAt: '2026-09-01T13:10:01.000Z',
          expiresAt: '2026-09-01T13:10:31.000Z'
        };
        socket.end(
          encodeFrame({ ...future, signature: signAgentEnvelope(future, 'agent-protocol-secret') })
        );
      },
      async (socketPath) => {
        const client = new ConfigAgentClient(options(socketPath));
        await expect(client.readInventory(actor)).rejects.toMatchObject({
          code: 'AGENT_RESPONSE_EXPIRED'
        });
      }
    );
  });

  it('rejects a bad response signature, request mismatch, schema drift, and trailing frames without exposing body data', async () => {
    const cases: Array<{ name: string; response: (request: Record<string, unknown>) => unknown }> =
      [
        {
          name: 'bad signature',
          response: (request) => ({
            ...responseFor(request, inventory),
            signature: `hmac-sha256:v1:${'0'.repeat(64)}`
          })
        },
        {
          name: 'request mismatch',
          response: (request) => responseFor({ ...request, requestId: 'REQ_other' }, inventory)
        },
        {
          name: 'schema drift',
          response: (request) => responseFor(request, { ...inventory, leaked: 'test-secret-value' })
        }
      ];
    for (const testCase of cases) {
      await withSocket(
        (request, socket) => {
          socket.end(encodeFrame(testCase.response(request)));
        },
        async (socketPath) => {
          const client = new ConfigAgentClient(options(socketPath));
          await expect(client.readInventory(actor)).rejects.toSatisfy((error: unknown) => {
            expect(error).toBeInstanceOf(ConfigAgentError);
            expect(String(error)).not.toContain('test-secret-value');
            return (error as ConfigAgentError).code !== '';
          });
        }
      );
    }

    await withSocket(
      (request, socket) => {
        const response = responseFor(request, inventory);
        socket.end(Buffer.concat([encodeFrame(response), encodeFrame(response)]));
      },
      async (socketPath) => {
        const client = new ConfigAgentClient(options(socketPath));
        await expect(client.readInventory(actor)).rejects.toMatchObject({
          code: 'AGENT_TRAILING_FRAME'
        });
      }
    );
  });

  it('enforces read and total deadlines and a response byte limit', async () => {
    await withSocket(
      () => undefined,
      async (socketPath) => {
        const client = new ConfigAgentClient(
          options(socketPath, { readTimeoutMs: 20, totalTimeoutMs: 200 })
        );
        await expect(client.readInventory(actor)).rejects.toMatchObject({
          code: 'AGENT_READ_TIMEOUT'
        });
      }
    );

    await withSocket(
      (_request, socket) => {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(1_048_576);
        socket.write(header);
        socket.write(Buffer.alloc(32));
      },
      async (socketPath) => {
        const client = new ConfigAgentClient(
          options(socketPath, { maximumResponseBytes: 32, totalTimeoutMs: 200 })
        );
        await expect(client.readInventory(actor)).rejects.toMatchObject({
          code: 'AGENT_RESPONSE_TOO_LARGE'
        });
      }
    );
  });

  it('uses the public signature helper with the versioned HMAC format', () => {
    const envelope = { operation: 'agent.capabilities', body: {}, version: 1 };
    expect(signAgentEnvelope(envelope, 'secret')).toMatch(/^hmac-sha256:v1:[a-f0-9]{64}$/u);
    expect(signAgentEnvelope(envelope, 'secret')).toBe(signAgentEnvelope(envelope, 'secret'));
    expect(signAgentEnvelope({ ...envelope, requestId: randomUUID() }, 'secret')).not.toBe(
      signAgentEnvelope(envelope, 'secret')
    );
  });

  it('uses locale-independent lexical ordering for nested envelope keys', () => {
    const envelope = {
      requestId: 'REQ_vector',
      operation: 'inventory.read',
      body: {
        appId: 'ops',
        appName: 'Ops Console',
        applyStrategy: 'restart'
      }
    };

    expect(signAgentEnvelope(envelope, 'secret')).toBe(
      'hmac-sha256:v1:ba0ab8d7186fbd6107990edfdd2ffddc8aeebe38d26930162ff0ad4dd3b4b860'
    );
  });
});
