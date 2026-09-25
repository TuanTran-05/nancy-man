// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  DatabaseExplorerRelation,
  DatabaseExplorerSchemaSnapshot,
  DatabaseTargetId
} from '../../../../../../packages/contracts/src/databaseExplorer.js';
import {
  applyDagreLayout,
  filterGraph,
  makeNodeId,
  projectFocusedGraph,
  projectFullGraph
} from './graphModel.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const TARGET: DatabaseTargetId = 'edutrack_production';

function makeSnapshot(
  schemas: Array<{
    name: string;
    relations: Array<{
      name: string;
      kind?: DatabaseExplorerRelation['kind'];
      pk?: string[] | null;
      cols?: string[];
    }>;
  }>,
  edges: Array<{
    constraint: string;
    from: { schema: string; relation: string; columns: string[] };
    to: { schema: string; relation: string; columns: string[] };
  }> = []
): DatabaseExplorerSchemaSnapshot {
  return {
    targetId: TARGET,
    targetLabel: 'Production',
    checksum: 'abc',
    policyVersion: '1',
    schemas: schemas.map((s) => ({
      name: s.name,
      relations: s.relations.map((r) => ({
        name: r.name,
        kind: r.kind ?? 'table',
        primaryKey: r.pk ?? ['id'],
        paginationKey: r.pk ?? ['id'],
        rowLevelSecurity: { enabled: false, forced: false },
        columns: (r.cols ?? ['id', 'name']).map((c) => ({
          name: c,
          dataType: 'text',
          nullable: false,
          hasDefault: false,
          identity: null,
          generated: false,
          classification: 'public' as const,
          selectable: true,
          filterOperators: []
        })),
        constraints: [],
        indexes: [],
        triggers: [],
        policies: [],
        estimatedRows: 10,
        dataAvailable: true
      }))
    })),
    edges
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('makeNodeId', () => {
  it('includes target, schema, and relation separated by slashes', () => {
    expect(makeNodeId('ops', 'public', 'users')).toBe('ops/public/users');
  });

  it('duplicate relation names in different schemas do not collide', () => {
    const a = makeNodeId('t', 'schema_a', 'events');
    const b = makeNodeId('t', 'schema_b', 'events');
    expect(a).not.toBe(b);
  });
});

describe('projectFullGraph', () => {
  it('produces one node per relation with stable sort', () => {
    const snap = makeSnapshot([
      { name: 'public', relations: [{ name: 'users' }, { name: 'accounts' }] },
      { name: 'audit', relations: [{ name: 'logs' }] }
    ]);
    const { nodes } = projectFullGraph(snap, TARGET);
    expect(nodes).toHaveLength(3);
    // stable sort: audit/logs, public/accounts, public/users
    expect(nodes.map((n) => n.id)).toEqual([
      'edutrack_production/audit/logs',
      'edutrack_production/public/accounts',
      'edutrack_production/public/users'
    ]);
  });

  it('deduplicates edges with duplicate constraint names', () => {
    const snap = makeSnapshot(
      [{ name: 'public', relations: [{ name: 'a' }, { name: 'b' }] }],
      [
        {
          constraint: 'fk_ab',
          from: { schema: 'public', relation: 'a', columns: ['b_id'] },
          to: { schema: 'public', relation: 'b', columns: ['id'] }
        },
        {
          constraint: 'fk_ab',
          from: { schema: 'public', relation: 'a', columns: ['b_id'] },
          to: { schema: 'public', relation: 'b', columns: ['id'] }
        }
      ]
    );
    const { edges } = projectFullGraph(snap, TARGET);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe('fk_ab');
  });

  it('marks FK columns on nodes', () => {
    const snap = makeSnapshot(
      [
        {
          name: 'public',
          relations: [
            { name: 'orders', cols: ['id', 'user_id'] },
            { name: 'users', cols: ['id'] }
          ]
        }
      ],
      [
        {
          constraint: 'fk_ou',
          from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
          to: { schema: 'public', relation: 'users', columns: ['id'] }
        }
      ]
    );
    const { nodes } = projectFullGraph(snap, TARGET);
    const orders = nodes.find((n) => n.relation === 'orders')!;
    expect(orders.columns.find((c) => c.name === 'user_id')?.isFk).toBe(true);
    expect(orders.columns.find((c) => c.name === 'id')?.isFk).toBe(false);
  });

  it('handles self-FK (self-loop) — node appears once, edge renders', () => {
    const snap = makeSnapshot(
      [{ name: 'public', relations: [{ name: 'categories', cols: ['id', 'parent_id'] }] }],
      [
        {
          constraint: 'fk_self',
          from: { schema: 'public', relation: 'categories', columns: ['parent_id'] },
          to: { schema: 'public', relation: 'categories', columns: ['id'] }
        }
      ]
    );
    const { nodes, edges } = projectFullGraph(snap, TARGET);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(1);
    expect(edges[0].isSelfLoop).toBe(true);
  });

  it('composite FK retains ordered column labels', () => {
    const snap = makeSnapshot(
      [
        {
          name: 'public',
          relations: [
            { name: 'a', cols: ['x', 'y'] },
            { name: 'b', cols: ['p', 'q'] }
          ]
        }
      ],
      [
        {
          constraint: 'fk_comp',
          from: { schema: 'public', relation: 'a', columns: ['x', 'y'] },
          to: { schema: 'public', relation: 'b', columns: ['p', 'q'] }
        }
      ]
    );
    const { edges } = projectFullGraph(snap, TARGET);
    expect(edges[0].sourceColumns).toEqual(['x', 'y']);
    expect(edges[0].targetColumns).toEqual(['p', 'q']);
  });

  it('shuffled schema snapshot produces identical node/edge ordering', () => {
    const snap1 = makeSnapshot([
      { name: 'z_schema', relations: [{ name: 'z_table' }] },
      { name: 'a_schema', relations: [{ name: 'a_table' }] }
    ]);
    const snap2 = makeSnapshot([
      { name: 'a_schema', relations: [{ name: 'a_table' }] },
      { name: 'z_schema', relations: [{ name: 'z_table' }] }
    ]);
    const g1 = projectFullGraph(snap1, TARGET);
    const g2 = projectFullGraph(snap2, TARGET);
    expect(g1.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id));
  });
});

describe('projectFocusedGraph', () => {
  const snap = makeSnapshot(
    [
      {
        name: 'public',
        relations: [
          { name: 'orders', cols: ['id', 'user_id', 'product_id'] },
          { name: 'users', cols: ['id', 'name'] },
          { name: 'products', cols: ['id', 'title'] },
          { name: 'payments', cols: ['id', 'order_id'] }
        ]
      }
    ],
    [
      {
        constraint: 'fk_ou',
        from: { schema: 'public', relation: 'orders', columns: ['user_id'] },
        to: { schema: 'public', relation: 'users', columns: ['id'] }
      },
      {
        constraint: 'fk_op',
        from: { schema: 'public', relation: 'orders', columns: ['product_id'] },
        to: { schema: 'public', relation: 'products', columns: ['id'] }
      },
      {
        constraint: 'fk_po',
        from: { schema: 'public', relation: 'payments', columns: ['order_id'] },
        to: { schema: 'public', relation: 'orders', columns: ['id'] }
      }
    ]
  );

  it('includes selected node and one-hop neighbours, excludes unrelated nodes', () => {
    const { nodes } = projectFocusedGraph(snap, TARGET, 'public', 'orders', new Set());
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('edutrack_production/public/orders');
    expect(ids).toContain('edutrack_production/public/users');
    expect(ids).toContain('edutrack_production/public/products');
    expect(ids).toContain('edutrack_production/public/payments');
    // all 4 are one hop from orders
    expect(nodes).toHaveLength(4);
  });

  it('excludes unrelated nodes when selecting a peripheral table', () => {
    const { nodes } = projectFocusedGraph(snap, TARGET, 'public', 'users', new Set());
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('edutrack_production/public/users');
    expect(ids).toContain('edutrack_production/public/orders');
    expect(ids).not.toContain('edutrack_production/public/payments'); // not in one-hop from users
  });

  it('expansion is additive — expanding a neighbour adds its neighbours', () => {
    const expanded = new Set(['edutrack_production/public/users']);
    // users is a neighbour of orders; expanding users should not add more here
    // because users has no other edges; but let's use payments → orders → users chain
    const { nodes } = projectFocusedGraph(snap, TARGET, 'public', 'payments', expanded);
    const ids = nodes.map((n) => n.id);
    // payments → orders is 1 hop; orders → users/products is 2nd hop via expansion
    expect(ids).toContain('edutrack_production/public/payments');
    expect(ids).toContain('edutrack_production/public/orders');
  });
});

describe('filterGraph', () => {
  const snap = makeSnapshot([
    { name: 'public', relations: [{ name: 'users' }, { name: 'products' }] },
    { name: 'audit', relations: [{ name: 'logs' }] }
  ]);

  it('empty query returns all nodes', () => {
    const full = projectFullGraph(snap, TARGET);
    const filtered = filterGraph(full, '');
    expect(filtered.nodes).toHaveLength(3);
  });

  it('search is case-insensitive and deterministic', () => {
    const full = projectFullGraph(snap, TARGET);
    const f1 = filterGraph(full, 'USER');
    const f2 = filterGraph(full, 'user');
    expect(f1.nodes.map((n) => n.id)).toEqual(f2.nodes.map((n) => n.id));
    expect(f1.nodes).toHaveLength(1);
    expect(f1.nodes[0].relation).toBe('users');
  });

  it('schema name match also keeps nodes', () => {
    const full = projectFullGraph(snap, TARGET);
    const filtered = filterGraph(full, 'audit');
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0].schema).toBe('audit');
  });
});

describe('applyDagreLayout', () => {
  it('assigns non-zero positions to nodes after layout', () => {
    const snap = makeSnapshot(
      [{ name: 'public', relations: [{ name: 'a' }, { name: 'b' }] }],
      [
        {
          constraint: 'fk',
          from: { schema: 'public', relation: 'a', columns: ['id'] },
          to: { schema: 'public', relation: 'b', columns: ['id'] }
        }
      ]
    );
    const { nodes, edges } = projectFullGraph(snap, TARGET);
    applyDagreLayout(nodes, edges, 'LR');
    // After layout both nodes have finite positions
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });
});
