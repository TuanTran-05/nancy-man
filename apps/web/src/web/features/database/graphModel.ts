/**
 * Pure graph-model projections for the Database Explorer.
 *
 * This module transforms a `DatabaseExplorerSchemaSnapshot` into typed
 * nodes/edges consumed by React Flow, with a separate Dagre-layout step.
 * All functions are deterministic (stable sort, deduplication by stable ID).
 */

import dagre from '@dagrejs/dagre';
import type {
  DatabaseExplorerRelation,
  DatabaseExplorerSchemaSnapshot,
  DatabaseRelationEdge
} from '../../../../../packages/contracts/src/databaseExplorer.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GraphRelationNode = {
  id: string; // "<targetId>/<schema>/<name>"
  schema: string;
  relation: string;
  kind: DatabaseExplorerRelation['kind'];
  primaryKey: string[] | null;
  columns: Array<{ name: string; dataType: string; isFk: boolean }>;
  columnCount: number;
  estimatedRows: number | null;
  /** Position set by layout; zero before layout is called. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GraphEdge = {
  id: string; // constraint name (globally unique within a target)
  constraint: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceColumns: string[];
  targetColumns: string[];
  isSelfLoop: boolean;
};

export type GraphModel = {
  nodes: GraphRelationNode[];
  edges: GraphEdge[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 220;
const NODE_HEIGHT_BASE = 80;
const NODE_HEIGHT_PER_COL = 22;
const MAX_COLS_SHOWN = 8;

// ---------------------------------------------------------------------------
// Node / Edge ID helpers
// ---------------------------------------------------------------------------

export function makeNodeId(targetId: string, schema: string, relation: string): string {
  return `${targetId}/${schema}/${relation}`;
}

// ---------------------------------------------------------------------------
// Column-level FK index helpers
// ---------------------------------------------------------------------------

/** Returns a Set of "<schema>/<relation>/<column>" strings that appear in FK edges. */
function buildFkColumns(edges: DatabaseRelationEdge[]): Set<string> {
  const set = new Set<string>();
  for (const e of edges) {
    for (const c of e.from.columns) set.add(`${e.from.schema}/${e.from.relation}/${c}`);
    for (const c of e.to.columns) set.add(`${e.to.schema}/${e.to.relation}/${c}`);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Project a schema snapshot into a full GraphModel
// ---------------------------------------------------------------------------

export function projectFullGraph(
  snapshot: DatabaseExplorerSchemaSnapshot,
  targetId: string
): GraphModel {
  const fkCols = buildFkColumns(snapshot.edges);

  // Build nodes — one per relation, stable sort schema then relation
  const nodes: GraphRelationNode[] = snapshot.schemas
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((s) =>
      s.relations
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => makeNode(targetId, s.name, r, fkCols))
    );

  // Build edges — deduplicate by constraint name
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of snapshot.edges) {
    if (seen.has(e.constraint)) continue;
    seen.add(e.constraint);
    edges.push(makeEdge(e, targetId));
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Project a one-hop focused subgraph for a selected relation
// ---------------------------------------------------------------------------

export function projectFocusedGraph(
  snapshot: DatabaseExplorerSchemaSnapshot,
  targetId: string,
  selectedSchema: string,
  selectedRelation: string,
  expandedNodeIds: ReadonlySet<string>
): GraphModel {
  const fkCols = buildFkColumns(snapshot.edges);
  const selectedId = makeNodeId(targetId, selectedSchema, selectedRelation);

  // Collect one-hop edges
  const relevantEdges = snapshot.edges.filter(
    (e) =>
      makeNodeId(targetId, e.from.schema, e.from.relation) === selectedId ||
      makeNodeId(targetId, e.to.schema, e.to.relation) === selectedId
  );

  // Collect relevant node IDs (selected + one hop)
  const relevantNodeIds = new Set<string>([selectedId]);
  for (const e of relevantEdges) {
    relevantNodeIds.add(makeNodeId(targetId, e.from.schema, e.from.relation));
    relevantNodeIds.add(makeNodeId(targetId, e.to.schema, e.to.relation));
  }

  // Add expanded neighbours
  if (expandedNodeIds.size > 0) {
    for (const e of snapshot.edges) {
      const fromId = makeNodeId(targetId, e.from.schema, e.from.relation);
      const toId = makeNodeId(targetId, e.to.schema, e.to.relation);
      if (expandedNodeIds.has(fromId) && relevantNodeIds.has(fromId)) {
        relevantNodeIds.add(toId);
        relevantEdges.push(e);
      }
      if (expandedNodeIds.has(toId) && relevantNodeIds.has(toId)) {
        relevantNodeIds.add(fromId);
        relevantEdges.push(e);
      }
    }
  }

  // Build nodes from relevant set
  const nodes: GraphRelationNode[] = [];
  for (const s of snapshot.schemas) {
    for (const r of s.relations) {
      const nid = makeNodeId(targetId, s.name, r.name);
      if (relevantNodeIds.has(nid)) {
        nodes.push(makeNode(targetId, s.name, r, fkCols));
      }
    }
  }
  // Stable sort
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Deduplicate edges
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of relevantEdges) {
    if (seen.has(e.constraint)) continue;
    seen.add(e.constraint);
    edges.push(makeEdge(e, targetId));
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Filter graph by search text (full ERD)
// ---------------------------------------------------------------------------

/**
 * Returns the graph filtered by `query`. Nodes whose schema or relation name
 * contains the query (case-insensitive) are kept. Edges are kept only when
 * both endpoints survive the filter.
 */
export function filterGraph(model: GraphModel, query: string): GraphModel {
  if (!query.trim()) return model;
  const q = query.toLowerCase();
  const keptIds = new Set(
    model.nodes
      .filter((n) => n.schema.toLowerCase().includes(q) || n.relation.toLowerCase().includes(q))
      .map((n) => n.id)
  );
  const nodes = model.nodes.filter((n) => keptIds.has(n.id));
  const edges = model.edges.filter(
    (e) => keptIds.has(e.sourceNodeId) && keptIds.has(e.targetNodeId)
  );
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Dagre layout
// ---------------------------------------------------------------------------

export type LayoutDirection = 'LR' | 'TB';

/**
 * Applies a Dagre layout in-place on the nodes and returns them.
 * Nodes are mutated with `x`/`y` positions.
 */
export function applyDagreLayout(
  nodes: GraphRelationNode[],
  edges: GraphEdge[],
  direction: LayoutDirection = 'LR'
): GraphRelationNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const h = Math.min(
      NODE_HEIGHT_BASE + n.columns.length * NODE_HEIGHT_PER_COL,
      NODE_HEIGHT_BASE + MAX_COLS_SHOWN * NODE_HEIGHT_PER_COL
    );
    g.setNode(n.id, { width: NODE_WIDTH, height: h });
    n.width = NODE_WIDTH;
    n.height = h;
  }

  for (const e of edges) {
    // Self-loops: dagre handles them, no skip needed
    g.setEdge(e.sourceNodeId, e.targetNodeId, { id: e.id });
  }

  dagre.layout(g);

  for (const n of nodes) {
    const pos = g.node(n.id);
    if (pos) {
      n.x = pos.x - n.width / 2;
      n.y = pos.y - n.height / 2;
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function makeNode(
  targetId: string,
  schema: string,
  r: DatabaseExplorerRelation,
  fkCols: Set<string>
): GraphRelationNode {
  const cols = r.columns.map((c) => ({
    name: c.name,
    dataType: c.dataType,
    isFk: fkCols.has(`${schema}/${r.name}/${c.name}`)
  }));
  return {
    id: makeNodeId(targetId, schema, r.name),
    schema,
    relation: r.name,
    kind: r.kind,
    primaryKey: r.primaryKey,
    columns: cols,
    columnCount: cols.length,
    estimatedRows: r.estimatedRows,
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT_BASE
  };
}

function makeEdge(e: DatabaseRelationEdge, targetId: string): GraphEdge {
  const sourceNodeId = makeNodeId(targetId, e.from.schema, e.from.relation);
  const targetNodeId = makeNodeId(targetId, e.to.schema, e.to.relation);
  return {
    id: e.constraint,
    constraint: e.constraint,
    sourceNodeId,
    targetNodeId,
    sourceColumns: e.from.columns,
    targetColumns: e.to.columns,
    isSelfLoop: sourceNodeId === targetNodeId
  };
}
