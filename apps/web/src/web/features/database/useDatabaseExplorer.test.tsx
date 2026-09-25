// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDatabaseExplorer } from './useDatabaseExplorer.js';
import type { SessionInfo } from '../../api.js';
import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRowsResponse,
  DatabaseTargetSummary
} from '../../../../../packages/contracts/src/databaseExplorer.js';

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

describe('useDatabaseExplorer hook', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
    expect(result.current.selectedTargetId).toBe('ops');
    expect(result.current.rows).toBeNull();
    expect(result.current.filters).toHaveLength(0);

    await waitFor(() => {
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
});
