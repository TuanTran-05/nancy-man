// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataGrid } from './DataGrid.js';
import type {
  DatabaseExplorerColumn,
  DatabaseRelationEdge,
  DatabaseRowsResponse
} from '../../../../../../packages/contracts/src/databaseExplorer.js';

afterEach(() => cleanup());

const mockColumns: DatabaseExplorerColumn[] = [
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
];

const mockRowsResponse: DatabaseRowsResponse = {
  targetId: 'edutrack_production',
  schemaChecksum: 'checksum1',
  policyVersion: '1.0',
  schema: 'public',
  relation: 'users',
  columns: mockColumns,
  rows: [
    {
      rowRef: 'signed-row-ref-1',
      cells: {
        id: { state: 'value', value: '11111111-1111-1111-1111-111111111111' },
        email: { state: 'masked', display: 'u***@example.com' },
        password_hash: { state: 'blocked' }
      }
    }
  ],
  nextCursor: 'next-page-cursor-token',
  truncated: false,
  encodedBytes: 300,
  consistency: 'stable',
  piiMode: 'masked'
};

const mockFkEdge: DatabaseRelationEdge = {
  constraint: 'fk_orders_user',
  from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
  to: { schema: 'public', relation: 'users', columns: ['id'] }
};

describe('DataGrid component', () => {
  it('renders table headers with sort buttons, safe cells, and blocked badge', () => {
    render(
      <DataGrid
        rowsResponse={mockRowsResponse}
        onSortChange={() => {}}
        onNextPage={() => {}}
        onPreviousPage={() => {}}
        hasPreviousPage={false}
        hasNextPage={true}
        onOpenCellDetail={() => {}}
        onFollowRelation={() => {}}
      />
    );

    // Column headers
    expect(screen.getByRole('button', { name: /Sắp xếp theo id/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sắp xếp theo email/i })).toBeInTheDocument();

    // Values in row
    expect(screen.getByText('11111111-1111-1111-1111-111111111111')).toBeInTheDocument();
    expect(screen.getByText('u***@example.com')).toBeInTheDocument();
    expect(screen.getByText('[Blocked]')).toBeInTheDocument();

    // Pagination
    expect(screen.getByRole('button', { name: 'Trang trước' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trang sau' })).toBeEnabled();
  });

  it('triggers onOpenCellDetail when cell is clicked', async () => {
    const user = userEvent.setup();
    const onOpenCell = vi.fn();

    render(
      <DataGrid
        rowsResponse={mockRowsResponse}
        onSortChange={() => {}}
        onNextPage={() => {}}
        onPreviousPage={() => {}}
        hasPreviousPage={false}
        hasNextPage={false}
        onOpenCellDetail={onOpenCell}
        onFollowRelation={() => {}}
      />
    );

    await user.click(screen.getByText('11111111-1111-1111-1111-111111111111'));
    expect(onOpenCell).toHaveBeenCalledWith('id', {
      state: 'value',
      value: '11111111-1111-1111-1111-111111111111'
    });
  });

  it('renders FK navigation buttons and calls onFollowRelation with rowRef', async () => {
    const user = userEvent.setup();
    const onFollow = vi.fn();

    render(
      <DataGrid
        rowsResponse={mockRowsResponse}
        edges={[mockFkEdge]}
        onSortChange={() => {}}
        onNextPage={() => {}}
        onPreviousPage={() => {}}
        hasPreviousPage={false}
        hasNextPage={false}
        onOpenCellDetail={() => {}}
        onFollowRelation={onFollow}
      />
    );

    const fkBtn = screen.getByRole('button', { name: /orders/i });
    expect(fkBtn).toBeInTheDocument();

    await user.click(fkBtn);
    expect(onFollow).toHaveBeenCalledWith(mockFkEdge, 'signed-row-ref-1');
  });

  it('shows best-effort warning when consistency is best_effort', () => {
    render(
      <DataGrid
        rowsResponse={{
          ...mockRowsResponse,
          consistency: 'best_effort'
        }}
        onSortChange={() => {}}
        onNextPage={() => {}}
        onPreviousPage={() => {}}
        hasPreviousPage={false}
        hasNextPage={false}
        onOpenCellDetail={() => {}}
        onFollowRelation={() => {}}
      />
    );

    expect(
      screen.getByText(/Bảng không có khóa chính hoặc unique index hợp lệ/i)
    ).toBeInTheDocument();
  });
});
