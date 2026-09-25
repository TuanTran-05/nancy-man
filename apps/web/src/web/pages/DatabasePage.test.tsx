// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatabasePage } from './DatabasePage.js';
import type { SessionInfo } from '../api.js';

afterEach(() => cleanup());

const mockTargetsResponse = {
  targets: [
    {
      id: 'edutrack_production',
      label: 'EduTrack Production',
      status: 'available',
      readOnly: true
    },
    {
      id: 'ops',
      label: 'Ops Database',
      status: 'available',
      readOnly: true
    }
  ]
};

const mockSchemaResponse = {
  targetId: 'edutrack_production',
  targetLabel: 'EduTrack Production',
  checksum: 'mock-checksum-1',
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
              filterOperators: ['eq']
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
              filterOperators: ['eq']
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
          estimatedRows: 100,
          dataAvailable: true,
          primaryKey: ['id'],
          paginationKey: ['id']
        }
      ]
    }
  ],
  edges: []
};

const mockRowsResponse = {
  targetId: 'edutrack_production',
  schemaChecksum: 'mock-checksum-1',
  policyVersion: '2026-09-25.1',
  schema: 'public',
  relation: 'users',
  columns: mockSchemaResponse.schemas[0].relations[0].columns,
  rows: [
    {
      rowRef: 'ref-1',
      cells: {
        id: { state: 'value', value: 'user-uuid-1' },
        email: { state: 'masked', display: 'u***@example.com' },
        password_hash: { state: 'blocked' }
      }
    }
  ],
  nextCursor: null,
  truncated: false,
  encodedBytes: 150,
  consistency: 'stable',
  piiMode: 'masked'
};

describe('DatabasePage component', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const sessionOwner: SessionInfo = {
    userId: 'user-owner',
    role: 'ops_owner',
    csrfToken: 'csrf-token-123'
  };

  const sessionViewer: SessionInfo = {
    userId: 'user-viewer',
    role: 'ops_viewer',
    csrfToken: 'csrf-viewer-456'
  };

  it('renders read-only badge, target selector, tabs, and does not have prohibited actions', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify(mockTargetsResponse), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaResponse), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/rows/query')) {
        return new Response(JSON.stringify(mockRowsResponse), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    render(<DatabasePage session={sessionOwner} onUnauthorized={() => {}} />);

    expect(await screen.findByText('Chỉ đọc')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Chọn cơ sở dữ liệu' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dữ liệu' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cấu trúc' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Quan hệ' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Toàn bộ ERD' })).toBeInTheDocument();

    // Verify absence of prohibited keywords
    const textContent = document.body.textContent || '';
    expect(textContent).not.toMatch(/\b(?:Chạy SQL|SQL Console|Export|Edit|Insert|Delete)\b/i);
    expect(
      screen.queryByRole('button', { name: /Chạy SQL|Export|Edit|Insert|Delete/i })
    ).not.toBeInTheDocument();
  });

  it('viewer role receives explanatory message in Data tab and has no PII reveal button', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify(mockTargetsResponse), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaResponse), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    render(<DatabasePage session={sessionViewer} onUnauthorized={() => {}} />);

    expect(
      await screen.findByText(/Role Viewer chỉ có quyền xem cấu trúc schema/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mở khóa PII' })).not.toBeInTheDocument();
  });

  it('owner can open PII reveal dialog and see privacy controls', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/database/targets')) {
        return new Response(JSON.stringify(mockTargetsResponse), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/schema')) {
        return new Response(JSON.stringify(mockSchemaResponse), { status: 200 });
      }
      if (url.endsWith('/api/v1/database/edutrack_production/rows/query')) {
        return new Response(JSON.stringify(mockRowsResponse), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const user = userEvent.setup();
    render(<DatabasePage session={sessionOwner} onUnauthorized={() => {}} />);

    const revealBtn = await screen.findByRole('button', { name: 'Mở khóa PII' });
    expect(revealBtn).toBeInTheDocument();

    await user.click(revealBtn);
    expect(
      await screen.findByRole('heading', { name: 'Mở khóa dữ liệu nhạy cảm (PII)' })
    ).toBeInTheDocument();
  });
});
