// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDatabaseSchema,
  getDatabaseTargets,
  hideDatabasePii,
  queryDatabaseRows,
  queryRelatedRows,
  revealDatabasePii
} from './databaseApi.js';

describe('databaseApi client', () => {
  const recordedCalls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    keepalive?: boolean;
  }> = [];

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    recordedCalls.length = 0;
    globalThis.fetch = originalFetch;
  });

  it('calls GET /api/v1/database/targets with cache: no-store', async () => {
    globalThis.fetch = async (input, init) => {
      recordedCalls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>
      });
      return new Response(
        JSON.stringify({ targets: [{ id: 'edutrack_production', label: 'EduTrack' }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    };

    const result = await getDatabaseTargets();
    expect(result.targets).toHaveLength(1);
    expect(recordedCalls[0]).toMatchObject({
      url: '/api/v1/database/targets',
      method: 'GET'
    });
  });

  it('calls GET /api/v1/database/:targetId/schema', async () => {
    globalThis.fetch = async (input, init) => {
      recordedCalls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>
      });
      return new Response(JSON.stringify({ targetId: 'edutrack_production', schemas: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const result = await getDatabaseSchema('edutrack_production');
    expect(result.targetId).toBe('edutrack_production');
    expect(recordedCalls[0]).toMatchObject({
      url: '/api/v1/database/edutrack_production/schema',
      method: 'GET'
    });
  });

  it('calls POST /api/v1/database/:targetId/rows/query with CSRF header', async () => {
    globalThis.fetch = async (input, init) => {
      recordedCalls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined
      });
      return new Response(JSON.stringify({ targetId: 'edutrack_production', rows: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const body = {
      schema: 'public',
      relation: 'users',
      pageSize: 25 as const,
      filters: [],
      piiMode: 'masked' as const
    };

    await queryDatabaseRows('edutrack_production', body, 'test-csrf');

    expect(recordedCalls[0]).toMatchObject({
      url: '/api/v1/database/edutrack_production/rows/query',
      method: 'POST',
      headers: expect.objectContaining({ 'X-Ops-CSRF': 'test-csrf' }),
      body: JSON.stringify(body)
    });
  });

  it('calls POST /api/v1/database/:targetId/relations/query with CSRF header', async () => {
    globalThis.fetch = async (input, init) => {
      recordedCalls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined
      });
      return new Response(JSON.stringify({ targetId: 'edutrack_production', rows: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const body = {
      schema: 'public',
      relation: 'courses',
      constraint: 'fk_courses_users',
      rowRef: 'signed-row-ref',
      pageSize: 25 as const,
      piiMode: 'masked' as const
    };

    await queryRelatedRows('edutrack_production', body, 'test-csrf');

    expect(recordedCalls[0]).toMatchObject({
      url: '/api/v1/database/edutrack_production/relations/query',
      method: 'POST',
      headers: expect.objectContaining({ 'X-Ops-CSRF': 'test-csrf' }),
      body: JSON.stringify(body)
    });
  });

  it('calls POST /api/v1/database/:targetId/pii-reveal and DELETE hide with CSRF header', async () => {
    globalThis.fetch = async (input, init) => {
      recordedCalls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
        keepalive: init?.keepalive
      });
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ revoked: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ expiresAt: '2026-09-25T13:00:00Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const revealBody = {
      password: 'SecretPassword123!',
      token: '123456',
      reason: 'Investigating incident INC-123'
    };
    const revealResult = await revealDatabasePii(
      'edutrack_production',
      revealBody,
      'csrf-token-123'
    );

    expect(revealResult).toEqual({ expiresAt: '2026-09-25T13:00:00Z' });
    expect(recordedCalls[0]).toMatchObject({
      url: '/api/v1/database/edutrack_production/pii-reveal',
      method: 'POST',
      headers: expect.objectContaining({ 'X-Ops-CSRF': 'csrf-token-123' }),
      body: JSON.stringify(revealBody)
    });

    await hideDatabasePii('csrf-token-123', { keepalive: true });

    expect(recordedCalls[1]).toMatchObject({
      url: '/api/v1/database/pii-reveal',
      method: 'DELETE',
      headers: expect.objectContaining({ 'X-Ops-CSRF': 'csrf-token-123' }),
      body: undefined,
      keepalive: true
    });
    expect(recordedCalls[1].headers).not.toHaveProperty('X-Ops-Database-Grant');
    expect(recordedCalls[1].body).toBeUndefined();
  });
});
