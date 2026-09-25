// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseExplorerSchemaSnapshot } from '../../../../../../packages/contracts/src/databaseExplorer.js';
import { FullErd } from './FullErd.js';

afterEach(cleanup);

const { fitViewMock } = vi.hoisted(() => ({ fitViewMock: vi.fn() }));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    children,
    onInit,
    nodes,
    onNodesChange
  }: {
    children?: React.ReactNode;
    onInit?: (instance: { fitView: typeof fitViewMock }) => void;
    nodes: Array<{ id: string; selected?: boolean }>;
    onNodesChange: (changes: Array<{ type: 'select'; id: string; selected: boolean }>) => void;
  }) => {
    React.useEffect(() => onInit?.({ fitView: fitViewMock }), [onInit]);
    return (
      <>
        <div
          data-testid="react-flow-erd"
          data-selected-node-count={nodes.filter((node) => node.selected).length}
        >
          {children}
        </div>
        <button
          type="button"
          data-testid="select-first-erd-node"
          onClick={() => {
            const firstNode = nodes[0];
            if (firstNode) {
              onNodesChange([{ type: 'select', id: firstNode.id, selected: true }]);
            }
          }}
        >
          Select first canvas node
        </button>
      </>
    );
  },
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  useNodesState: (initial: Array<{ id: string; selected?: boolean }>) => {
    const [nodes, setNodes] = React.useState(initial);
    const onNodesChange = React.useCallback(
      (changes: Array<{ type: 'select'; id: string; selected: boolean }>) => {
        setNodes((current) =>
          current.map((node) => {
            const selectionChange = changes.find(
              (change) => change.type === 'select' && change.id === node.id
            );
            return selectionChange ? { ...node, selected: selectionChange.selected } : node;
          })
        );
      },
      []
    );
    return [nodes, setNodes, onNodesChange] as const;
  },
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
          },
          {
            name: 'user_profiles',
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
          },
          {
            name: 'user_events',
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

function makeLargeSnap(): DatabaseExplorerSchemaSnapshot {
  const base = makeSnap();
  const relationTemplate = base.schemas[0].relations[0];
  const relationSpecs = Array.from({ length: 101 }, (_, index) => ({
    schema: index < 51 ? 'schema_a' : 'schema_b',
    name: `table_${String(index).padStart(3, '0')}`
  }));
  return {
    ...base,
    schemas: ['schema_a', 'schema_b'].map((schemaName) => ({
      name: schemaName,
      relations: relationSpecs
        .filter((relation) => relation.schema === schemaName)
        .map((relation) => ({ ...relationTemplate, name: relation.name }))
    })),
    edges: Array.from({ length: 210 }, (_, index) => {
      const from = relationSpecs[index % relationSpecs.length];
      const to = relationSpecs[(index + 1) % relationSpecs.length];
      return {
        constraint: `fk_${String(index).padStart(3, '0')}`,
        from: { schema: from.schema, relation: from.name, columns: ['id'] },
        to: { schema: to.schema, relation: to.name, columns: ['id'] }
      };
    })
  };
}

describe('FullErd', () => {
  it('renders the React Flow ERD canvas', () => {
    render(<FullErd snapshot={makeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    expect(screen.getByTestId('react-flow-erd')).toBeTruthy();
  });

  it('does not refit after the initial fit when a canvas node is selected', async () => {
    fitViewMock.mockClear();
    render(<FullErd snapshot={makeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);

    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('select-first-erd-node'));

    await waitFor(() =>
      expect(screen.getByTestId('react-flow-erd')).toHaveAttribute('data-selected-node-count', '1')
    );
    expect(fitViewMock).toHaveBeenCalledTimes(1);
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

  it('focuses the unique search result in the canvas and accessible table', async () => {
    const user = userEvent.setup();
    fitViewMock.mockClear();
    render(<FullErd snapshot={makeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'logs');

    const focusedRelation = screen.getByRole('button', { name: 'Chọn audit.logs' });
    expect(focusedRelation).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('audit.logs');
    await waitFor(() =>
      expect(fitViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ nodes: [{ id: 'prod/audit/logs' }] })
      )
    );
  });

  it('focuses the first stable matching relation when the search is ambiguous and inputs are shuffled', async () => {
    const snapshot = makeSnap();
    const shuffledSnapshot = {
      ...snapshot,
      schemas: snapshot.schemas
        .slice()
        .reverse()
        .map((schema) => ({ ...schema, relations: schema.relations.slice().reverse() })),
      edges: snapshot.edges.slice().reverse()
    };
    const focusedIds: string[] = [];

    for (const input of [snapshot, shuffledSnapshot]) {
      cleanup();
      fitViewMock.mockClear();
      const user = userEvent.setup();
      render(<FullErd snapshot={input} targetId="prod" onSelectRelation={vi.fn()} />);
      await user.type(screen.getByRole('searchbox'), 'user');
      const focusedRelation = screen.getByRole('button', { name: 'Chọn audit.user_events' });
      expect(focusedRelation).toHaveAttribute('aria-current', 'true');
      await waitFor(() =>
        expect(fitViewMock).toHaveBeenCalledWith(
          expect.objectContaining({ nodes: [{ id: 'prod/audit/user_events' }] })
        )
      );
      focusedIds.push(focusedRelation.getAttribute('aria-label') ?? '');
    }

    expect(focusedIds).toEqual(['Chọn audit.user_events', 'Chọn audit.user_events']);
  });

  it('restores the complete 101-relation and 210-edge projection after clearing search', async () => {
    render(<FullErd snapshot={makeLargeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'table_007' } });
    expect(screen.getByText('1 bảng · 0 quan hệ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));

    expect(screen.getByText('101 bảng · 210 quan hệ')).toBeInTheDocument();
  });

  it('fits the full deterministic canvas after unique and ambiguous searches are cleared', async () => {
    const expectedFitNodes = Array.from({ length: 101 }, (_, index) => {
      const schema = index < 51 ? 'schema_a' : 'schema_b';
      const relation = `table_${String(index).padStart(3, '0')}`;
      return { id: `prod/${schema}/${relation}` };
    });
    fitViewMock.mockClear();
    render(<FullErd snapshot={makeLargeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    const search = screen.getByRole('searchbox');

    for (const query of ['table_007', 'table_0']) {
      fireEvent.change(search, { target: { value: query } });

      const expectedRelation = query === 'table_007' ? 'table_007' : 'table_000';
      expect(
        screen.getByRole('button', { name: `Chọn schema_a.${expectedRelation}` })
      ).toHaveAttribute('aria-current', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
      await waitFor(() =>
        expect(fitViewMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ nodes: expectedFitNodes })
        )
      );
      expect(screen.getByText('101 bảng · 210 quan hệ')).toBeInTheDocument();
    }
  });

  it('fits all nodes when clearing a search with no matches', async () => {
    const expectedFitNodes = Array.from({ length: 101 }, (_, index) => {
      const schema = index < 51 ? 'schema_a' : 'schema_b';
      const relation = `table_${String(index).padStart(3, '0')}`;
      return { id: `prod/${schema}/${relation}` };
    });
    fitViewMock.mockClear();
    render(<FullErd snapshot={makeLargeSnap()} targetId="prod" onSelectRelation={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'there-is-no-match' } });
    expect(screen.getByText('0 bảng · 0 quan hệ')).toBeInTheDocument();

    const callsBeforeClear = fitViewMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    await waitFor(() =>
      expect(fitViewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ nodes: expectedFitNodes })
      )
    );
    expect(fitViewMock.mock.calls.length).toBeGreaterThan(callsBeforeClear);
    expect(screen.getByText('101 bảng · 210 quan hệ')).toBeInTheDocument();
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
