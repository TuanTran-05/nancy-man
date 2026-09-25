// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelatedRowsDrawer } from './RelatedRowsDrawer.js';
import type {
  DatabaseRelationEdge,
  DatabaseRowsResponse
} from '../../../../../packages/contracts/src/databaseExplorer.js';

afterEach(() => cleanup());

const mockEdge: DatabaseRelationEdge = {
  constraint: 'fk_orders_user',
  from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
  to: { schema: 'public', relation: 'users', columns: ['id'] }
};

const mockRows: DatabaseRowsResponse = {
  targetId: 'edutrack_production',
  schemaChecksum: 'checksum1',
  policyVersion: '1.0',
  schema: 'public',
  relation: 'orders',
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
      name: 'amount',
      dataType: 'numeric',
      nullable: false,
      hasDefault: false,
      identity: null,
      generated: false,
      classification: 'public',
      selectable: true,
      filterOperators: ['eq']
    }
  ],
  rows: [
    {
      rowRef: 'order-1',
      cells: {
        id: { state: 'value', value: 'order-uuid-1' },
        amount: { state: 'value', value: '500000' }
      }
    }
  ],
  nextCursor: null,
  truncated: false,
  encodedBytes: 120,
  consistency: 'stable',
  piiMode: 'masked'
};

describe('RelatedRowsDrawer component', () => {
  it('renders constraint information and related rows', () => {
    render(
      <RelatedRowsDrawer
        open={true}
        edge={mockEdge}
        sourceRowRef="user-ref-1"
        rowsResponse={mockRows}
        onClose={() => {}}
        onNextPage={() => {}}
        onPreviousPage={() => {}}
        hasPreviousPage={false}
        hasNextPage={false}
        onOpenCellDetail={() => {}}
      />
    );

    expect(
      screen.getByRole('heading', { name: /Bản ghi liên quan qua fk_orders_user/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/public\.orders \(user_id\) → public\.users \(id\)/)
    ).toBeInTheDocument();
    expect(screen.getByText('order-uuid-1')).toBeInTheDocument();
    expect(screen.getByText('500000')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <RelatedRowsDrawer
        open={true}
        edge={mockEdge}
        sourceRowRef="user-ref-1"
        rowsResponse={mockRows}
        onClose={onClose}
        onNextPage={() => {}}
        onPreviousPage={() => {}}
        hasPreviousPage={false}
        hasNextPage={false}
        onOpenCellDetail={() => {}}
      />
    );

    const closeButtons = screen.getAllByRole('button', { name: 'Đóng' });
    await user.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
