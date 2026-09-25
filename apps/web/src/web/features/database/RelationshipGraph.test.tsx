// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseExplorerSchemaSnapshot } from '../../../../../packages/contracts/src/databaseExplorer.js';
import { RelationshipGraph } from './RelationshipGraph.js';

afterEach(cleanup);

// Mock @xyflow/react so we don't need a DOM canvas/WebGL
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  MarkerType: { ArrowClosed: 'arrowclosed' }
}));

import React from 'react';

function makeSnapshot(
  edges: Array<{
    constraint: string;
    from: { schema: string; relation: string; columns: string[] };
    to: { schema: string; relation: string; columns: string[] };
  }> = []
): DatabaseExplorerSchemaSnapshot {
  return {
    targetId: 'prod' as any,
    targetLabel: 'Production',
    checksum: 'x',
    policyVersion: '1',
    schemas: [
      {
        name: 'public',
        relations: [
          {
            name: 'orders',
            kind: 'table' as any,
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
                classification: 'public' as any,
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
                classification: 'public' as any,
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
          },
          {
            name: 'users',
            kind: 'table' as any,
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
                classification: 'public' as any,
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
          }
        ]
      }
    ],
    edges
  };
}

describe('RelationshipGraph', () => {
  it('renders the React Flow container', () => {
    const snap = makeSnapshot([
      {
        constraint: 'fk_ou',
        from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
        to: { schema: 'public', relation: 'users', columns: ['id'] }
      }
    ]);
    render(
      <RelationshipGraph
        snapshot={snap}
        targetId="prod"
        selectedSchema="public"
        selectedRelation="orders"
        onSelectRelation={vi.fn()}
      />
    );
    expect(screen.getByTestId('react-flow')).toBeTruthy();
  });

  it('renders an accessible relationship list alongside the graph', () => {
    const snap = makeSnapshot([
      {
        constraint: 'fk_ou',
        from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
        to: { schema: 'public', relation: 'users', columns: ['id'] }
      }
    ]);
    render(
      <RelationshipGraph
        snapshot={snap}
        targetId="prod"
        selectedSchema="public"
        selectedRelation="orders"
        onSelectRelation={vi.fn()}
      />
    );
    // The semantic relationship list should be present for keyboard/screen-reader access
    expect(screen.getByRole('table', { name: /quan hệ/i })).toBeTruthy();
    expect(screen.getByText('fk_ou')).toBeTruthy();
  });

  it('calls onSelectRelation when a row in the accessible table is clicked', async () => {
    const user = userEvent.setup();
    const onSelectRelation = vi.fn();
    const snap = makeSnapshot([
      {
        constraint: 'fk_ou',
        from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
        to: { schema: 'public', relation: 'users', columns: ['id'] }
      }
    ]);
    render(
      <RelationshipGraph
        snapshot={snap}
        targetId="prod"
        selectedSchema="public"
        selectedRelation="orders"
        onSelectRelation={onSelectRelation}
      />
    );
    const usersBtn = screen.getByRole('button', { name: /public\.users/i });
    await user.click(usersBtn);
    expect(onSelectRelation).toHaveBeenCalledWith('public', 'users');
  });

  it('shows empty state when selected relation has no FK edges', () => {
    const snap = makeSnapshot([]); // no edges
    render(
      <RelationshipGraph
        snapshot={snap}
        targetId="prod"
        selectedSchema="public"
        selectedRelation="orders"
        onSelectRelation={vi.fn()}
      />
    );
    expect(screen.getByText(/không có quan hệ/i)).toBeTruthy();
  });
});
