import express from 'express';
import { describe, expect, it } from 'vitest';

import { createSqlRouter } from './sqlRoutes.js';

describe('createSqlRouter', () => {
  it('lets an authenticated maintainer classify SQL through the private worker without exposing a credential', async () => {
    const commands: unknown[] = [];
    const app = express();
    app.use(
      '/sql',
      createSqlRouter({
        authorize: async () => ({
          userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
          sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
          role: 'ops_maintainer'
        }),
        worker: {
          command: async (input) => {
            commands.push(input);
            return {
              protocolVersion: 1,
              commandId: 'cmd_1',
              ok: true,
              result: { allowed: true, kind: 'select' }
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
      const response = await fetch(`http://127.0.0.1:${address.port}/sql/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: '__Host-ops-session=opaque' },
        body: JSON.stringify({ sql: 'SELECT id FROM students' })
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        classification: { allowed: true, kind: 'select' }
      });
      expect(commands).toEqual([
        {
          actor: {
            userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
            sessionId: 'f16f9426-010c-4e06-a459-9fd18c4a442e',
            role: 'ops_maintainer'
          },
          kind: 'sql.classify',
          payload: { sql: 'SELECT id FROM students' }
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('refuses SQL workspace access to a viewer before contacting the worker', async () => {
    let called = false;
    const app = express();
    app.use(
      '/sql',
      createSqlRouter({
        authorize: async () => ({ userId: 'user', sessionId: 'session', role: 'ops_viewer' }),
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
      const response = await fetch(`http://127.0.0.1:${address.port}/sql/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1' })
      });
      expect(response.status).toBe(403);
      expect(called).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('classifies a proposed DML statement through the private worker without executing it', async () => {
    const commands: unknown[] = [];
    const app = express();
    app.use(
      '/sql',
      createSqlRouter({
        authorize: async () => ({ userId: 'user', sessionId: 'session', role: 'ops_maintainer' }),
        worker: {
          command: async (input) => {
            commands.push(input);
            return {
              protocolVersion: 1,
              commandId: 'cmd',
              ok: true,
              result: { allowed: true, kind: 'delete', requiresTypedConfirmation: true }
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
      const response = await fetch(`http://127.0.0.1:${address.port}/sql/classify-mutation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: '__Host-ops-session=opaque' },
        body: JSON.stringify({ sql: 'DELETE FROM public.students' })
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        classification: { allowed: true, kind: 'delete', requiresTypedConfirmation: true }
      });
      expect(commands).toEqual([
        {
          actor: { userId: 'user', sessionId: 'session', role: 'ops_maintainer' },
          kind: 'sql.classifyMutation',
          payload: { sql: 'DELETE FROM public.students' }
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('requires a CSRF-protected SQL elevation before a maintainer can request a preview', async () => {
    const authorizations: unknown[] = [];
    const previews: unknown[] = [];
    const app = express();
    app.use(
      '/sql',
      createSqlRouter({
        authorize: async (input) => {
          authorizations.push(input);
          return { userId: 'user', sessionId: 'session', role: 'ops_maintainer' };
        },
        worker: {
          command: async () => ({
            protocolVersion: 1,
            commandId: 'cmd',
            ok: true,
            result: { allowed: true, kind: 'select' }
          })
        },
        preview: {
          preview: async (input) => {
            previews.push(input);
            return {
              status: 'previewed',
              executionKey: 'SQL-20260822-execution',
              previewId: 'PRV_execution',
              expiresAt: '2026-08-22T10:05:00.000Z',
              result: { rows: [{ id: 1 }], encodedBytes: 10, truncated: false }
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
      const response = await fetch(`http://127.0.0.1:${address.port}/sql/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: '__Host-ops-session=opaque',
          'X-Ops-CSRF': 'csrf-token'
        },
        body: JSON.stringify({
          sql: 'SELECT id FROM students',
          reason: 'Investigate issue ERR_01K3',
          maxRows: 100
        })
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        executionKey: 'SQL-20260822-execution',
        previewId: 'PRV_execution',
        expiresAt: '2026-08-22T10:05:00.000Z',
        result: { rows: [{ id: 1 }], encodedBytes: 10, truncated: false }
      });
      expect(authorizations).toEqual([
        {
          cookieHeader: '__Host-ops-session=opaque',
          csrfToken: 'csrf-token',
          mutation: true
        }
      ]);
      expect(previews).toEqual([
        {
          actor: { userId: 'user', sessionId: 'session', role: 'ops_maintainer' },
          sql: 'SELECT id FROM students',
          reason: 'Investigate issue ERR_01K3',
          maxRows: 100
        }
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('lets an ops viewer read bounded SQL execution history without opening the SQL workspace', async () => {
    const app = express();
    app.use(
      '/sql',
      createSqlRouter({
        authorize: async () => ({ userId: 'viewer', sessionId: 'session', role: 'ops_viewer' }),
        worker: {
          command: async () => {
            throw new Error('must not classify');
          }
        },
        history: {
          list: async (input) => [{ executionKey: 'SQL-20260822-000123', limit: input.limit }]
        }
      })
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test server');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sql/executions?limit=20`, {
        headers: { Cookie: '__Host-ops-session=opaque' }
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        executions: [{ executionKey: 'SQL-20260822-000123', limit: 20 }]
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
