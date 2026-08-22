import express from 'express';
import { describe, expect, it } from 'vitest';

import { createSchemaRouter } from './schemaRoutes.js';

describe('createSchemaRouter', () => {
  it('lets an authenticated viewer read structural schema metadata through the private worker', async () => {
    const commands: unknown[] = [];
    const app = express();
    app.use(
      '/database',
      createSchemaRouter({
        authorize: async () => ({ userId: 'viewer', sessionId: 'session', role: 'ops_viewer' }),
        worker: {
          command: async (input) => {
            commands.push(input);
            return {
              protocolVersion: 1,
              commandId: 'cmd_1',
              ok: true,
              result: { checksum: 'a'.repeat(64), schemas: [] }
            };
          }
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test server');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/database/schema`, {
        headers: { Cookie: '__Host-ops-session=opaque' }
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ checksum: 'a'.repeat(64), schemas: [] });
      expect(commands).toEqual([
        {
          actor: { userId: 'viewer', sessionId: 'session', role: 'ops_viewer' },
          kind: 'schema.read',
          payload: {}
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('does not ask the worker for a schema when the session has no SQL read permission', async () => {
    let called = false;
    const app = express();
    app.use(
      '/database',
      createSchemaRouter({
        authorize: async () => null,
        worker: {
          command: async () => {
            called = true;
            throw new Error('must not run');
          }
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test server');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/database/schema`);
      expect(response.status).toBe(401);
      expect(called).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('does not relay an invalid worker response to the browser', async () => {
    const app = express();
    app.use(
      '/database',
      createSchemaRouter({
        authorize: async () => ({ userId: 'viewer', sessionId: 'session', role: 'ops_viewer' }),
        worker: {
          command: async () => ({
            protocolVersion: 1,
            commandId: 'cmd_1',
            ok: true,
            result: { databaseUrl: 'must-not-leak' }
          })
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test server');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/database/schema`, {
        headers: { Cookie: '__Host-ops-session=opaque' }
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ code: 'WORKER_SCHEMA_INVALID' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
