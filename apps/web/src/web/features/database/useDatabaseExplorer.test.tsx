// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { useDatabaseExplorer } from './useDatabaseExplorer.js';
import type { SessionInfo } from '../../api.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRelationEdge,
  DatabaseRowsResponse,
  DatabaseTargetSummary
} from '../../../../../../packages/contracts/src/databaseExplorer.js';

const mockTargets: DatabaseTargetSummary[] = [
  { id: 'edutrack_production', label: 'EduTrack Production', status: 'available', readOnly: true },
  { id: 'ops', label: 'Ops Database', status: 'available', readOnly: true }
];

const mockSchemaEdutrack: DatabaseExplorerSchemaSnapshot = {
  targetId: 'edutrack_production',
  targetLabel: 'EduTrack Production',
  checksum: 'abc123checksum',
  policyVersion: '2026-09-25.1',
  schemas: [
    {
      name: 'public',
      relations: [
        {
          name: 'users',
          kind: 'table',
          rowLevelSecurity: { enabled: true, forced: false },
          columns: [
            {
              name: 'id',
              dataType: 'uuid',
              nullable: false,
              hasDefault: true,
              identity: null,
              generated: false,
              classification: 'public',
              selectable: true,
              filterOperators: ['eq', 'neq']
            },
            {
              name: 'email',
              dataType: 'text',
              nullable: false,
              hasDefault: false,
              identity: null,
              generated: false,
              classification: 'pii',
              selectable: true,
              filterOperators: ['eq', 'contains']
            },
            {
              name: 'password_hash',
              dataType: 'text',
              nullable: false,
              hasDefault: false,
              identity: null,
              generated: false,
              classification: 'blocked',
              selectable: false,
              filterOperators: []
            }
          ],
          constraints: [],
          indexes: [],
          triggers: [],
          policies: [],
          estimatedRows: 1500,
          dataAvailable: true,
          primaryKey: ['id'],
          paginationKey: ['id']
        }
      ]
    }
  ],
  edges: []
};

const mockSchemaOps: DatabaseExplorerSchemaSnapshot = {
  targetId: 'ops',
  targetLabel: 'Ops Database',
  checksum: 'ops456checksum',
  policyVersion: '2026-09-25.1',
  schemas: [
    {
      name: 'public',
      relations: [
        {
          name: 'audit_logs',
          kind: 'table',
          rowLevelSecurity: { enabled: false, forced: false },
          columns: [
            {
              name: 'id',
              dataType: 'bigint',
              nullable: false,
              hasDefault: true,
              identity: null,
              generated: false,
              classification: 'public',
              selectable: true,
              filterOperators: ['eq']
            }
          ],
          constraints: [],
          indexes: [],
          triggers: [],
          policies: [],
          estimatedRows: 50,
          dataAvailable: true,
          primaryKey: ['id'],
          paginationKey: ['id']
        }
      ]
    }
  ],
  edges: []
};

const mockRowsMasked: DatabaseRowsResponse = {
  targetId: 'edutrack_production',
  schemaChecksum: 'abc123checksum',
  policyVersion: '2026-09-25.1',
  schema: 'public',
  relation: 'users',
  columns: mockSchemaEdutrack.schemas[0].relations[0].columns,
  rows: [
    {
      rowRef: 'ref-1',
      cells: {
        id: { state: 'value', value: 'u-1' },
        email: { state: 'masked', display: 'u***@example.com' },
        password_hash: { state: 'blocked' }
      }
    }
  ],
  nextCursor: null,
  truncated: false,
  encodedBytes: 250,
  consistency: 'stable',
  piiMode: 'masked'
};

const mockRowsRevealed: DatabaseRowsResponse = {
  ...mockRowsMasked,
  piiMode: 'revealed',
  rows: [
    {
      rowRef: 'ref-revealed',
      cells: {
        id: { state: 'value', value: 'u-1' },
        email: { state: 'value', value: 'pii-sentinel@example.com' },
        password_hash: { state: 'blocked' }
      }
    }
  ]
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useDatabaseExplorer hook', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const sessionOwner: SessionInfo = {
    userId: 'user-1',
    role: 'ops_owner',
    csrfToken: 'csrf-secret-123'
  };

  it('loads targets and first schema on mount, and loads rows for owner', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/rows/query')) {
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({
        session: sessionOwner,
        onUnauthorized: () => {}
      })
    );

    await waitFor(() => {
      expect(result.current.targets).toHaveLength(2);
      expect(result.current.selectedTargetId).toBe('edutrack_production');
      expect(result.current.schema?.targetId).toBe('edutrack_production');
      expect(result.current.selectedRelationName).toBe('users');
      expect(result.current.rows?.rows).toHaveLength(1);
    });
  });

  it('switching target clears rows, selection, cursors, filters, and reveal state before loading new schema', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/pii-reveal')) {
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/rows/query')) {
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/ops/schema')) {
        return new Response(JSON.stringify(mockSchemaOps), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/ops/rows/query')) {
        return new Response(
          JSON.stringify({
            ...mockRowsMasked,
            targetId: 'ops',
            relation: 'audit_logs',
            rows: []
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({
        session: sessionOwner,
        onUnauthorized: () => {}
      })
    );

    await waitFor(() => {
      expect(result.current.selectedTargetId).toBe('edutrack_production');
      expect(result.current.rows).not.toBeNull();
    });

    // Switch target to ops
    act(() => {
      result.current.selectTarget('ops');
    });

    // Check that state was reset immediately
    expect(result.current.rows).toBeNull();
    expect(result.current.filters).toHaveLength(0);

    await waitFor(() => {
      expect(result.current.selectedTargetId).toBe('ops');
      expect(result.current.schema?.targetId).toBe('ops');
      expect(result.current.selectedRelationName).toBe('audit_logs');
    });
  });

  it('viewer role sees schema but does not fetch rows', async () => {
    const sessionViewer: SessionInfo = {
      userId: 'user-2',
      role: 'ops_viewer',
      csrfToken: 'csrf-viewer'
    };

    const rowsQueryCalled = { called: false };

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/rows/query')) {
        rowsQueryCalled.called = true;
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({
        session: sessionViewer,
        onUnauthorized: () => {}
      })
    );

    await waitFor(() => {
      expect(result.current.schema?.targetId).toBe('edutrack_production');
    });

    expect(rowsQueryCalled.called).toBe(false);
    expect(result.current.rows).toBeNull();
  });

  it('does not revoke on unmount when no grant exists', async () => {
    const revokeCalls: Array<{ url: string; keepalive?: boolean }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        revokeCalls.push({ url, keepalive: init.keepalive });
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(
      () => useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    unmount();
    await Promise.resolve();

    expect(revokeCalls).toEqual([]);
  });

  it('best-effort revokes an active grant once on unmount with keepalive', async () => {
    const revokeCalls: Array<{
      url: string;
      method?: string;
      keepalive?: boolean;
      body?: BodyInit | null;
      headers?: HeadersInit;
    }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        return new Response(
          JSON.stringify(body.piiMode === 'revealed' ? mockRowsRevealed : mockRowsMasked),
          { status: 200 }
        );
      }
      if (url.endsWith('/pii-reveal') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ expiresAt: new Date(Date.now() + 300_000).toISOString() }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        revokeCalls.push({
          url,
          method: init.method,
          keepalive: init.keepalive,
          body: init.body,
          headers: init.headers
        });
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount, rerender } = renderHook(
      ({ activeSession }: { activeSession: SessionInfo }) =>
        useDatabaseExplorer({ session: activeSession, onUnauthorized: () => {} }),
      {
        initialProps: { activeSession: sessionOwner },
        wrapper
      }
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));
    expect(revokeCalls).toHaveLength(0);
    await act(async () => {
      await result.current.handleReveal('password', '123456', 'Investigating INC-123');
    });
    expect(result.current.piiReveal.active).toBe(true);

    rerender({ activeSession: { ...sessionOwner, csrfToken: 'csrf-token-latest' } });
    expect(result.current.piiReveal.active).toBe(true);
    expect(revokeCalls).toHaveLength(0);

    unmount();
    await waitFor(() => expect(revokeCalls).toHaveLength(1));
    expect(revokeCalls[0]).toMatchObject({
      url: '/api/v1/database/pii-reveal',
      method: 'DELETE',
      keepalive: true,
      body: undefined
    });
    const headers = new Headers(revokeCalls[0].headers);
    expect(headers.get('X-Ops-CSRF')).toBe('csrf-token-latest');
    expect(headers.has('X-Ops-Database-Grant')).toBe(false);
  });

  it('revokes once after an in-flight reveal succeeds after unmount without loading revealed rows', async () => {
    const revealPost = deferred<Response>();
    const revealStarted = deferred<void>();
    const operations: string[] = [];
    const revokes: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        return new Response(
          JSON.stringify(body.piiMode === 'revealed' ? mockRowsRevealed : mockRowsMasked),
          { status: 200 }
        );
      }
      if (url.endsWith('/edutrack_production/pii-reveal') && init?.method === 'POST') {
        operations.push('reveal:started');
        revealStarted.resolve();
        return revealPost.promise.then((response) => {
          operations.push('reveal:resolved');
          return response;
        });
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        revokes.push({ url, init });
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result, unmount } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));

    let revealAction!: Promise<void>;
    act(() => {
      revealAction = result.current.handleReveal('password', '123456', 'Investigating INC-123');
    });
    await revealStarted.promise;
    unmount();

    await act(async () => {
      revealPost.resolve(
        new Response(JSON.stringify({ expiresAt: new Date(Date.now() + 300_000).toISOString() }), {
          status: 200
        })
      );
      await revealAction;
    });

    expect(operations).toEqual(['rows:masked', 'reveal:started', 'reveal:resolved', 'revoke']);
    expect(revokes).toHaveLength(1);
    expect(revokes[0]).toMatchObject({
      url: '/api/v1/database/pii-reveal',
      init: { method: 'DELETE', keepalive: true }
    });
    expect(revokes[0].init?.body).toBeUndefined();
    const headers = new Headers(revokes[0].init?.headers);
    expect(headers.has('X-Ops-Database-Grant')).toBe(false);
    expect(operations).not.toContain('rows:revealed');
  });

  it('does not revoke when an in-flight reveal POST fails after unmount', async () => {
    const revealPost = deferred<Response>();
    const revealStarted = deferred<void>();
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        operations.push('rows');
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/edutrack_production/pii-reveal') && init?.method === 'POST') {
        operations.push('reveal');
        revealStarted.resolve();
        return revealPost.promise;
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result, unmount } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));
    let revealAction!: Promise<void>;
    act(() => {
      revealAction = result.current.handleReveal('password', '123456', 'Investigating INC-123');
    });
    await revealStarted.promise;
    unmount();
    await act(async () => {
      revealPost.reject(new Error('network failure'));
      await revealAction;
    });

    expect(operations).toEqual(['rows', 'reveal']);
  });

  it('reloads masked rows after revealed-row loading fails and global revoke succeeds', async () => {
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        if (body.piiMode === 'revealed') {
          return new Response(JSON.stringify({ code: 'REVEALED_ROWS_UNAVAILABLE' }), {
            status: 503
          });
        }
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/pii-reveal') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ expiresAt: new Date(Date.now() + 300_000).toISOString() }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));
    await act(async () => {
      await expect(
        result.current.handleReveal('password', '123456', 'Investigating INC-123')
      ).rejects.toThrow('REVEALED_ROWS_UNAVAILABLE');
    });

    expect(operations.slice(-3)).toEqual(['rows:revealed', 'revoke', 'rows:masked']);
    expect(result.current.piiReveal.active).toBe(false);
    expect(result.current.rows?.piiMode).toBe('masked');
    expect(JSON.stringify(result.current.rows)).not.toContain('pii-sentinel@example.com');
  });

  it('keeps empty state and does not reload masked rows if reveal recovery revoke fails', async () => {
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        if (body.piiMode === 'revealed') {
          return new Response(JSON.stringify({ code: 'REVEALED_ROWS_UNAVAILABLE' }), {
            status: 503
          });
        }
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/pii-reveal') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ expiresAt: new Date(Date.now() + 300_000).toISOString() }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ code: 'REVOKE_UNAVAILABLE' }), { status: 503 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));
    await act(async () => {
      await expect(
        result.current.handleReveal('password', '123456', 'Investigating INC-123')
      ).rejects.toThrow('REVEALED_ROWS_UNAVAILABLE');
    });

    expect(operations.slice(-2)).toEqual(['rows:revealed', 'revoke']);
    expect(operations.filter((operation) => operation === 'rows:masked')).toHaveLength(1);
    expect(result.current.piiReveal.active).toBe(false);
    expect(result.current.rows).toBeNull();
    expect(result.current.error).toBe('REVOKE_UNAVAILABLE');
  });

  it('ignores a stale revealed-row failure after hide and does not race a second revoke', async () => {
    const revealedRows = deferred<Response>();
    const revealedQueryStarted = deferred<void>();
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        if (body.piiMode === 'revealed') {
          revealedQueryStarted.resolve();
          return revealedRows.promise;
        }
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/pii-reveal') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ expiresAt: new Date(Date.now() + 300_000).toISOString() }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));
    let revealPromise!: Promise<void>;
    await act(async () => {
      revealPromise = result.current.handleReveal('password', '123456', 'Investigating INC-123');
      await revealedQueryStarted.promise;
    });
    await act(async () => {
      await result.current.handleHide();
    });
    revealedRows.resolve(
      new Response(JSON.stringify({ code: 'STALE_QUERY_FAILED' }), { status: 503 })
    );
    await act(async () => {
      await revealPromise;
    });

    expect(operations.filter((operation) => operation === 'revoke')).toHaveLength(1);
    expect(operations.slice(-2)).toEqual(['revoke', 'rows:masked']);
    expect(result.current.error).toBeNull();
    expect(result.current.piiReveal.active).toBe(false);
    expect(result.current.rows?.piiMode).toBe('masked');
    expect(JSON.stringify(result.current.rows)).not.toContain('STALE_QUERY_FAILED');
  });

  it('keeps the display masked until revealed rows arrive and discards them after hide', async () => {
    const revealedRows = deferred<Response>();
    const revealedQueryStarted = deferred<void>();
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        if (body.piiMode === 'revealed') {
          revealedQueryStarted.resolve();
          return revealedRows.promise;
        }
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/pii-reveal') && init?.method === 'POST') {
        return new Response(JSON.stringify({ expiresAt: '2026-09-25T14:00:00Z' }), {
          status: 200
        });
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));

    let revealPromise!: Promise<void>;
    await act(async () => {
      revealPromise = result.current.handleReveal('password', '123456', 'Investigating INC-123');
      await revealedQueryStarted.promise;
    });
    expect(result.current.piiReveal.active).toBe(false);
    expect(result.current.rows?.rows[0].cells.email.state).toBe('masked');

    await act(async () => {
      revealedRows.resolve(new Response(JSON.stringify(mockRowsRevealed), { status: 200 }));
      await revealPromise;
    });
    expect(result.current.piiReveal.active).toBe(true);
    expect(result.current.rows?.rows[0].cells.email).toEqual({
      state: 'value',
      value: 'pii-sentinel@example.com'
    });

    let revokePromise!: Promise<void>;
    await act(async () => {
      revokePromise = result.current.handleHide();
      await revokePromise;
    });
    expect(operations.slice(-2)).toEqual(['revoke', 'rows:masked']);
    expect(result.current.piiReveal.active).toBe(false);
    expect(result.current.rows?.rows[0].cells.email.state).toBe('masked');
  });

  it('clears every sensitive layer before revoke and ignores an in-flight revealed response', async () => {
    const revealedRows = deferred<Response>();
    const revealedQueryStarted = deferred<void>();
    const revoke = deferred<Response>();
    const revokeStarted = deferred<void>();
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        if (body.piiMode === 'revealed') {
          revealedQueryStarted.resolve();
          return revealedRows.promise;
        }
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/relations/query')) {
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/pii-reveal') && init?.method === 'POST') {
        return new Response(JSON.stringify({ expiresAt: '2026-09-25T14:00:00Z' }), {
          status: 200
        });
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        revokeStarted.resolve();
        return revoke.promise;
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    const edge: DatabaseRelationEdge = {
      constraint: 'fk_orders_user',
      from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
      to: { schema: 'public', relation: 'users', columns: ['id'] }
    };
    await act(async () => {
      result.current.setSelectedCell({
        rowRef: 'ref-1',
        column: 'email',
        cell: mockRowsMasked.rows[0].cells.email
      });
      await result.current.followRelation(edge, 'signed-row-ref');
    });

    let revealPromise!: Promise<void>;
    await act(async () => {
      revealPromise = result.current.handleReveal('password', '123456', 'Investigating INC-123');
      await revealedQueryStarted.promise;
    });
    let hidePromise!: Promise<void>;
    act(() => {
      hidePromise = result.current.handleHide();
    });
    expect(result.current.rows).toBeNull();
    expect(result.current.selectedCell).toBeNull();
    expect(result.current.relatedRowsDrawer).toBeNull();
    expect(result.current.cursorStack).toEqual([]);
    expect(result.current.currentCursor).toBeUndefined();
    expect(result.current.piiReveal.active).toBe(false);

    await act(async () => {
      await revokeStarted.promise;
      revealedRows.resolve(new Response(JSON.stringify(mockRowsRevealed), { status: 200 }));
      await revealPromise;
    });
    expect(operations).toContain('revoke');
    expect(result.current.rows).toBeNull();
    expect(result.current.selectedCell).toBeNull();
    expect(result.current.relatedRowsDrawer).toBeNull();
    expect(result.current.piiReveal.active).toBe(false);

    await act(async () => {
      revoke.resolve(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
      await hidePromise;
    });
    expect(operations.slice(-2)).toEqual(['revoke', 'rows:masked']);
    expect(result.current.rows?.piiMode).toBe('masked');
    expect(JSON.stringify(result.current.rows)).not.toContain('pii-sentinel@example.com');
  });

  it('keeps privacy state empty and does not reload if revoke fails', async () => {
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        return new Response(JSON.stringify({ ...mockRowsMasked, nextCursor: 'main-next' }), {
          status: 200
        });
      }
      if (url.endsWith('/relations/query')) {
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ message: 'revoke unavailable' }), { status: 503 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    act(() => result.current.goToNextPage());
    await waitFor(() => expect(result.current.currentCursor).toBe('main-next'));
    const edge: DatabaseRelationEdge = {
      constraint: 'fk_orders_user',
      from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
      to: { schema: 'public', relation: 'users', columns: ['id'] }
    };
    await act(async () => {
      result.current.setSelectedCell({
        rowRef: 'ref-1',
        column: 'email',
        cell: mockRowsMasked.rows[0].cells.email
      });
      await result.current.followRelation(edge, 'signed-row-ref');
    });
    expect(result.current.relatedRowsDrawer?.open).toBe(true);
    expect(result.current.cursorStack).toEqual(['']);
    await act(async () => {
      await result.current.handleHide();
    });

    expect(result.current.rows).toBeNull();
    expect(result.current.selectedCell).toBeNull();
    expect(result.current.relatedRowsDrawer).toBeNull();
    expect(result.current.cursorStack).toEqual([]);
    expect(result.current.currentCursor).toBeUndefined();
    expect(result.current.piiReveal.active).toBe(false);
    expect(result.current.error).toBe('HTTP_503');
    expect(operations.at(-1)).toBe('revoke');
    expect(operations.filter((operation) => operation === 'rows:masked')).toHaveLength(2);
  });

  it('uses selected FK source in both directions and owns a resettable related cursor stack', async () => {
    const relatedCalls: Array<Record<string, unknown>> = [];
    const edge: DatabaseRelationEdge = {
      constraint: 'fk_orders_tenant_user',
      from: { schema: 'public', relation: 'orders', columns: ['tenant_id', 'user_id'] },
      to: { schema: 'public', relation: 'users', columns: ['tenant_id', 'id'] }
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/relations/query')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        relatedCalls.push(body);
        const nextCursor = body.cursor === 'related-next' ? null : 'related-next';
        return new Response(JSON.stringify({ ...mockRowsMasked, nextCursor }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.schema).not.toBeNull());

    await act(async () => {
      await result.current.followRelation(edge, 'encrypted-row-ref');
    });
    expect(relatedCalls[0]).toMatchObject({
      schema: 'public',
      relation: 'users',
      constraint: 'fk_orders_tenant_user',
      rowRef: 'encrypted-row-ref'
    });
    expect(result.current.relatedRowsDrawer?.rows?.nextCursor).toBe('related-next');

    await act(async () => {
      await result.current.goToRelatedNextPage();
    });
    expect(relatedCalls[1]).toMatchObject({ cursor: 'related-next', relation: 'users' });
    expect(result.current.relatedRowsDrawer?.cursorStack).toEqual(['']);

    await act(async () => {
      await result.current.goToRelatedPreviousPage();
    });
    expect(relatedCalls[2]).not.toHaveProperty('cursor');
    expect(result.current.relatedRowsDrawer?.cursorStack).toEqual([]);

    act(() => result.current.closeRelatedDrawer());
    expect(result.current.relatedRowsDrawer).toBeNull();
    act(() => result.current.selectRelation('public', 'orders'));
    await act(async () => {
      await result.current.followRelation(edge, 'encrypted-row-ref-2');
    });
    expect(relatedCalls[3]).toMatchObject({ schema: 'public', relation: 'orders' });
    expect(relatedCalls[3]).not.toHaveProperty('cursor');
  });

  it('switches targets only after clearing state and successfully revoking globally', async () => {
    const revoke = deferred<Response>();
    const revokeStarted = deferred<void>();
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        operations.push('schema:edutrack_production');
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/ops/schema')) {
        operations.push('schema:ops');
        return new Response(JSON.stringify(mockSchemaOps), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        return new Response(JSON.stringify({ ...mockRowsMasked, nextCursor: 'target-next' }), {
          status: 200
        });
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        revokeStarted.resolve();
        return revoke.promise;
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    act(() => result.current.goToNextPage());
    await waitFor(() => expect(result.current.currentCursor).toBe('target-next'));
    const edge: DatabaseRelationEdge = {
      constraint: 'fk_orders_user',
      from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
      to: { schema: 'public', relation: 'users', columns: ['id'] }
    };
    act(() => {
      result.current.setSelectedCell({
        rowRef: 'ref-1',
        column: 'email',
        cell: mockRowsMasked.rows[0].cells.email
      });
      result.current.setRelatedRowsDrawer({
        open: true,
        edge,
        rowRef: 'signed-row-ref',
        sourceSchema: 'public',
        sourceRelation: 'users',
        targetId: 'edutrack_production',
        schemaChecksum: 'abc123checksum',
        loading: false,
        rows: mockRowsMasked,
        cursorStack: ['related-previous'],
        currentCursor: 'related-next'
      });
    });
    let switchPromise!: Promise<void>;
    act(() => {
      switchPromise = result.current.selectTarget('ops');
    });
    expect(result.current.rows).toBeNull();
    expect(result.current.selectedCell).toBeNull();
    expect(result.current.relatedRowsDrawer).toBeNull();
    expect(result.current.cursorStack).toEqual([]);
    expect(result.current.currentCursor).toBeUndefined();
    await act(async () => {
      await revokeStarted.promise;
    });
    expect(operations.at(-1)).toBe('revoke');
    expect(operations).not.toContain('schema:ops');

    await act(async () => {
      revoke.resolve(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
      await switchPromise;
    });
    await waitFor(() => expect(result.current.schema?.targetId).toBe('ops'));
    expect(operations.indexOf('revoke')).toBeLessThan(operations.indexOf('schema:ops'));
  });

  it('expires PII through the same clear, global revoke, and masked reload sequence', async () => {
    const operations: string[] = [];
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        const body = JSON.parse(String(init?.body)) as { piiMode?: string };
        operations.push(`rows:${body.piiMode}`);
        return new Response(
          JSON.stringify(body.piiMode === 'revealed' ? mockRowsRevealed : mockRowsMasked),
          { status: 200 }
        );
      }
      if (url.endsWith('/pii-reveal') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
          {
            status: 200
          }
        );
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ revoked: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows?.piiMode).toBe('masked'));
    await act(async () => {
      await result.current.handleReveal('password', '123456', 'Investigating INC-123');
    });
    expect(result.current.piiReveal.active).toBe(true);

    const expiryTick = intervalSpy.mock.calls.at(-1)?.[0] as (() => void) | undefined;
    expect(expiryTick).toBeDefined();
    await act(async () => {
      expiryTick?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(operations.slice(-2)).toEqual(['revoke', 'rows:masked']));
    expect(result.current.piiReveal.active).toBe(false);
    expect(result.current.rows?.piiMode).toBe('masked');
  });

  it('does not load the requested target when global revoke fails during target switch', async () => {
    const operations: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify({ targets: mockTargets }), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        operations.push('schema:edutrack_production');
        return new Response(JSON.stringify(mockSchemaEdutrack), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/ops/schema')) {
        operations.push('schema:ops');
        return new Response(JSON.stringify(mockSchemaOps), { status: 200 });
      }
      if (url.endsWith('/rows/query')) {
        operations.push('rows');
        return new Response(JSON.stringify(mockRowsMasked), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/pii-reveal') && init?.method === 'DELETE') {
        operations.push('revoke');
        return new Response(JSON.stringify({ message: 'revoke unavailable' }), { status: 503 });
      }
      return new Response('{}', { status: 404 });
    };

    const { result } = renderHook(() =>
      useDatabaseExplorer({ session: sessionOwner, onUnauthorized: () => {} })
    );
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    await act(async () => {
      await result.current.selectTarget('ops');
    });

    expect(result.current.rows).toBeNull();
    expect(result.current.schema).toBeNull();
    expect(result.current.error).toBe('HTTP_503');
    expect(result.current.selectedTargetId).toBe('edutrack_production');
    expect(operations.at(-1)).toBe('revoke');
    expect(operations).not.toContain('schema:ops');
  });
});
