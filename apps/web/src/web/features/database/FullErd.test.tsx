// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseExplorerSchemaSnapshot } from '../../../../../../packages/contracts/src/databaseExplorer.js';
import { FullErd } from './FullErd.js';

afterEach(cleanup);

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow-erd">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  MarkerType: { ArrowClosed: 'arrowclosed' }
}));

import React from 'react';

function makeSnap(): DatabaseExplorerSchemaSnapshot {
  return {
    targetId: 'edutrack_production',
    targetLabel: 'Production',
    checksum: 'x',
    policyVersion: '1',
    schemas: [
      {
        name: 'public',
        relations: [
          {
            name: 'users',
            kind: 'table',
            primaryKey: ['id'],
            paginationKey: ['id'],
            rowLevelSecurity: { enabled: false, forced: false },
            columns: [
              {
                name: 'id',
                dataType: 'int4',
                nullable: false,
                hasDefault: true,
                identity: 'always',
                generated: false,
                classification: 'public',
                selectable: true,
                filterOperators: []
              }
            ],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            estimatedRows: 50,
            dataAvailable: true
          },
          {
            name: 'orders',
            kind: 'table',
            primaryKey: ['id'],
            paginationKey: ['id'],
            rowLevelSecurity: { enabled: false, forced: false },
            columns: [
              {
                name: 'id',
                dataType: 'int4',
                nullable: false,
                hasDefault: true,
                identity: 'always',
                generated: false,
                classification: 'public',
                selectable: true,
                filterOperators: []
              },
              {
                name: 'user_id',
                dataType: 'int4',
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: 'public',
                selectable: true,
                filterOperators: []
              }
            ],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            estimatedRows: 100,
            dataAvailable: true
          }
        ]
      },
      {
        name: 'audit',
        relations: [
          {
            name: 'logs',
            kind: 'table',
            primaryKey: ['id'],
            paginationKey: ['id'],
            rowLevelSecurity: { enabled: false, forced: false },
            columns: [
              {
                name: 'id',
                dataType: 'int4',
                nullable: false,
                hasDefault: true,
                identity: 'always',
                generated: false,
                classification: 'public',
                selectable: true,
                filterOperators: []
              }
            ],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            estimatedRows: 1000,
            dataAvailable: true
          }
        ]
      }
    ],
    edges: [
      {
        constraint: 'fk_ou',
        from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
        to: { schema: 'public', relation: 'users', columns: ['id'] }
      }
    ]
  };
}

describe('FullErd', () => {
  it('renders the React Flow ERD canvas', () => {
    render(<FullErd snapshot={makeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    expect(screen.getByTestId('react-flow-erd')).toBeTruthy();
  });

  it('shows schema group labels', () => {
    render(<FullErd snapshot={makeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    // Schema names visible in multiple elements (group label + a11y heading)
    expect(screen.getAllByText(/public/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/audit/i).length).toBeGreaterThan(0);
  });

  it('search input filters nodes: only matching names remain visible', async () => {
    const user = userEvent.setup();
    render(<FullErd snapshot={makeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    const searchInput = screen.getByRole('searchbox');
    await user.type(searchInput, 'logs');
    // After filtering, the result count should mention 1 table
    expect(screen.getByText(/1 bảng/i)).toBeTruthy();
  });

  it('calls onSelectRelation when accessible table row button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectRelation = vi.fn();
    render(<FullErd snapshot={makeSnap()} targetId="prod" onSelectRelation={onSelectRelation} />);
    // The accessible table includes a button for each relation
    const usersBtns = screen.getAllByRole('button', { name: /public\.users/i });
    await user.click(usersBtns[0]);
    expect(onSelectRelation).toHaveBeenCalledWith('public', 'users');
  });
});
