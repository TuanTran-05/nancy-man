// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { RelatedRowsDrawer } from './RelatedRowsDrawer.js';
import type {
  DatabaseRelationEdge,
  DatabaseRowsResponse
} from '../../../../../../packages/contracts/src/databaseExplorer.js';

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
    expect(screen.getByRole('table', { name: 'Bản ghi liên quan' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'id' })).toHaveAttribute('scope', 'col');
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

  it('supports Escape and returns focus to the opener when the drawer closes', async () => {
    const user = userEvent.setup();
    function DrawerHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open related rows
          </button>
          <RelatedRowsDrawer
            open={open}
            edge={mockEdge}
            sourceRowRef="user-ref-1"
            rowsResponse={mockRows}
            onClose={() => setOpen(false)}
            onNextPage={() => {}}
            onPreviousPage={() => {}}
            hasPreviousPage={false}
            hasNextPage={false}
            onOpenCellDetail={() => {}}
          />
        </>
      );
    }

    render(<DrawerHarness />);
    const opener = screen.getByRole('button', { name: 'Open related rows' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: /fk_orders_user/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Đóng' })[0]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('announces drawer loading, error, and empty states', () => {
    const props = {
      open: true,
      edge: mockEdge,
      sourceRowRef: 'user-ref-1',
      onClose: () => {},
      onNextPage: () => {},
      onPreviousPage: () => {},
      hasPreviousPage: false,
      hasNextPage: false,
      onOpenCellDetail: () => {}
    };
    const { rerender } = render(
      <RelatedRowsDrawer {...props} rowsResponse={null} loading={true} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải bản ghi liên quan');

    rerender(
      <RelatedRowsDrawer {...props} rowsResponse={null} loading={false} error="Request failed" />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed');

    rerender(
      <RelatedRowsDrawer
        {...props}
        rowsResponse={{ ...mockRows, rows: [] }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Không tìm thấy bản ghi liên quan');
  });
});
