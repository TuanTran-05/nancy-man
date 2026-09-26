import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance
} from '@xyflow/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseExplorerSchemaSnapshot } from '../../../../../../packages/contracts/src/databaseExplorer.js';
import {
  applyDagreLayout,
  filterGraph,
  projectFullGraph,
  type GraphEdge,
  type GraphRelationNode
} from './graphModel.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type FullErdProps = {
  snapshot: DatabaseExplorerSchemaSnapshot;
  targetId: string;
  onSelectRelation: (schema: string, relation: string) => void;
};

// ---------------------------------------------------------------------------
// React Flow custom node for full ERD (compact, initially collapsed columns)
// ---------------------------------------------------------------------------

type ErdNodeData = {
  schema: string;
  relation: string;
  kind: string;
  primaryKey: string[] | null;
  columns: Array<{ name: string; dataType: string; isFk: boolean }>;
  columnCount: number;
  expanded: boolean;
  onSelect: (schema: string, relation: string) => void;
  onToggleExpand: (id: string) => void;
  nodeId: string;
  searchFocused: boolean;
};

type ErdFlowNode = Node<ErdNodeData, 'erdNode'>;
type ErdFlowEdge = Edge;

function ErdNode({ data }: { data: ErdNodeData }) {
  return (
    <div
      className={`erd-node erd-node--${data.kind.replace('_', '-')} ${data.searchFocused ? 'erd-node--search-focus' : ''}`}
      data-search-focused={data.searchFocused ? 'true' : undefined}
    >
      <div className="erd-node-header">
        <span className="erd-node-schema">{data.schema}</span>
        <button
          type="button"
          className="erd-node-title link-button"
          onClick={() => data.onSelect(data.schema, data.relation)}
          aria-label={`Chọn bảng ${data.schema}.${data.relation}`}
        >
          {data.relation}
        </button>
        <button
          type="button"
          className="erd-expand-btn"
          onClick={() => data.onToggleExpand(data.nodeId)}
          aria-expanded={data.expanded}
          aria-label={data.expanded ? 'Thu gọn cột' : 'Mở rộng cột'}
        >
          {data.expanded ? '▲' : '▼'}
        </button>
      </div>
      <div className="erd-node-meta">
        <span className="erd-kind-badge">{data.kind}</span>
        {data.primaryKey && <span className="erd-pk-badge">PK: {data.primaryKey.join(', ')}</span>}
        <span className="erd-col-count">{data.columnCount} cột</span>
      </div>
      {data.expanded && (
        <ul className="erd-node-columns">
          {data.columns.map((c) => (
            <li
              key={c.name}
              className={`erd-node-col ${c.isFk ? 'erd-node-col--fk' : ''} ${data.primaryKey?.includes(c.name) ? 'erd-node-col--pk' : ''}`}
            >
              <span className="erd-col-name">{c.name}</span>
              <span className="erd-col-type">{c.dataType}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const nodeTypes = { erdNode: ErdNode };

// ---------------------------------------------------------------------------
// Convert graph model → React Flow
// ---------------------------------------------------------------------------

function toFlowNodes(
  nodes: GraphRelationNode[],
  expandedIds: Set<string>,
  searchFocusedNodeId: string | null,
  onSelect: (schema: string, relation: string) => void,
  onToggleExpand: (id: string) => void
) {
  return nodes.map((n) => ({
    id: n.id,
    type: 'erdNode' as const,
    position: { x: n.x, y: n.y },
    data: {
      schema: n.schema,
      relation: n.relation,
      kind: n.kind,
      primaryKey: n.primaryKey,
      columns: n.columns,
      columnCount: n.columnCount,
      expanded: expandedIds.has(n.id),
      onSelect,
      onToggleExpand,
      nodeId: n.id,
      searchFocused: n.id === searchFocusedNodeId
    } satisfies ErdNodeData,
    selected: n.id === searchFocusedNodeId,
    style: { width: n.width }
  }));
}

function toFlowEdges(edges: GraphEdge[]) {
  return edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    label: `${e.sourceColumns.join(', ')} → ${e.targetColumns.join(', ')}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: false,
    className: e.isSelfLoop ? 'graph-edge--self' : ''
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FullErd({ snapshot, targetId, onSelectRelation }: FullErdProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const flowInstanceRef = useRef<ReactFlowInstance<ErdFlowNode, ErdFlowEdge> | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  // Compute full graph, then filter by search
  const fullGraph = useMemo(() => {
    const g = projectFullGraph(snapshot, targetId);
    applyDagreLayout(g.nodes, g.edges, 'TB');
    return g;
  }, [snapshot, targetId]);
  const lastFitRequestRef = useRef<{
    fullGraph: typeof fullGraph;
    normalizedSearchQuery: string;
  } | null>(null);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredGraph = useMemo(
    () => filterGraph(fullGraph, normalizedSearchQuery),
    [fullGraph, normalizedSearchQuery]
  );
  const searchFocusedNode = normalizedSearchQuery ? (filteredGraph.nodes[0] ?? null) : null;

  const handleSelect = useCallback(
    (schema: string, relation: string) => {
      onSelectRelation(schema, relation);
    },
    [onSelectRelation]
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleFlowInit = useCallback((instance: ReactFlowInstance<ErdFlowNode, ErdFlowEdge>) => {
    flowInstanceRef.current = instance;
    setCanvasReady(true);
  }, []);

  const flowNodes = useMemo(
    () =>
      toFlowNodes(
        filteredGraph.nodes,
        expandedNodeIds,
        searchFocusedNode?.id ?? null,
        handleSelect,
        handleToggleExpand
      ),
    [filteredGraph.nodes, expandedNodeIds, searchFocusedNode?.id, handleSelect, handleToggleExpand]
  );

  const flowEdges = useMemo(() => toFlowEdges(filteredGraph.edges), [filteredGraph.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<ErdFlowNode>(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ErdFlowEdge>(flowEdges);

  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  useEffect(() => {
    const instance = flowInstanceRef.current;
    if (!canvasReady || !instance) return;

    // Wait until React Flow has received the nodes for this search state. On
    // clear this prevents a fit against the previous filtered subset.
    const nodeStateMatchesProjection =
      nodes.length === flowNodes.length &&
      nodes.every((node, index) => node.id === flowNodes[index]?.id);
    if (!nodeStateMatchesProjection) return;

    const previousFitRequest = lastFitRequestRef.current;
    if (
      previousFitRequest?.fullGraph === fullGraph &&
      previousFitRequest.normalizedSearchQuery === normalizedSearchQuery
    ) {
      return;
    }

    const currentFitRequest = { fullGraph, normalizedSearchQuery };
    if (normalizedSearchQuery) {
      if (!searchFocusedNode) {
        lastFitRequestRef.current = currentFitRequest;
        return;
      }
      void instance.fitView({
        nodes: [{ id: searchFocusedNode.id }],
        padding: 0.35,
        duration: 200
      });
    } else {
      void instance.fitView({
        nodes: flowNodes.map(({ id }) => ({ id })),
        padding: 0.15,
        duration: 200
      });
    }
    lastFitRequestRef.current = currentFitRequest;
  }, [canvasReady, flowNodes, fullGraph, nodes, normalizedSearchQuery, searchFocusedNode?.id]);

  // Group nodes by schema for the accessible table
  const schemaGroups = useMemo(() => {
    const groups = new Map<string, GraphRelationNode[]>();
    for (const n of filteredGraph.nodes) {
      const list = groups.get(n.schema) ?? [];
      list.push(n);
      groups.set(n.schema, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredGraph.nodes]);

  const totalNodes = filteredGraph.nodes.length;
  const totalEdges = filteredGraph.edges.length;

  return (
    <div className="full-erd-container">
      {/* Search and info bar */}
      <div className="erd-toolbar">
        <input
          type="search"
          role="searchbox"
          className="erd-search-input"
          placeholder="Tìm schema hoặc bảng…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Tìm kiếm trong ERD"
        />
        <span className="erd-info">
          {totalNodes} bảng · {totalEdges} quan hệ
        </span>
        {searchFocusedNode && (
          <span className="erd-search-focus-status" role="status" aria-live="polite">
            Tập trung bảng {searchFocusedNode.schema}.{searchFocusedNode.relation}
          </span>
        )}
        {searchQuery && (
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => setSearchQuery('')}
          >
            Xóa tìm kiếm
          </button>
        )}
      </div>

      {/* Schema group labels (visible in DOM for screen readers) */}
      <div className="erd-schema-groups" aria-hidden="true">
        {schemaGroups.map(([schema]) => (
          <span key={schema} className="erd-schema-label">
            {schema}
          </span>
        ))}
      </div>

      {/* React Flow canvas */}
      <div className="erd-canvas-wrapper" aria-hidden="true">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          onInit={handleFlowInit}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      {/* Accessible ERD table for keyboard / screen-reader */}
      <details className="erd-a11y-details">
        <summary>Toàn bộ bảng và quan hệ (dành cho bàn phím / screen reader)</summary>
        {schemaGroups.map(([schema, schemaNodes]) => (
          <section key={schema} className="erd-a11y-schema-section">
            <h4 className="erd-a11y-schema-name">Schema: {schema}</h4>
            <table className="graph-a11y-table" aria-label={`Bảng trong schema ${schema}`}>
              <thead>
                <tr>
                  <th>Bảng</th>
                  <th>Loại</th>
                  <th>PK</th>
                  <th>Số cột</th>
                </tr>
              </thead>
              <tbody>
                {schemaNodes.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <button
                        type="button"
                        className={`link-button ${searchFocusedNode?.id === n.id ? 'erd-search-focus-indicator' : ''}`}
                        onClick={() => handleSelect(n.schema, n.relation)}
                        aria-label={`Chọn ${n.schema}.${n.relation}`}
                        aria-current={searchFocusedNode?.id === n.id ? 'true' : undefined}
                      >
                        {n.schema}.{n.relation}
                      </button>
                    </td>
                    <td>{n.kind}</td>
                    <td>{n.primaryKey?.join(', ') ?? '—'}</td>
                    <td>{n.columnCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {totalEdges > 0 && (
          <section className="erd-a11y-schema-section">
            <h4 className="erd-a11y-schema-name">Quan hệ khóa ngoại</h4>
            <table className="graph-a11y-table" aria-label="Quan hệ khóa ngoại toàn bộ ERD">
              <thead>
                <tr>
                  <th>Constraint</th>
                  <th>Từ bảng</th>
                  <th>Cột nguồn</th>
                  <th>Đến bảng</th>
                  <th>Cột đích</th>
                </tr>
              </thead>
              <tbody>
                {filteredGraph.edges.map((e) => {
                  const src = filteredGraph.nodes.find((n) => n.id === e.sourceNodeId);
                  const tgt = filteredGraph.nodes.find((n) => n.id === e.targetNodeId);
                  return (
                    <tr key={e.id}>
                      <td>{e.constraint}</td>
                      <td>
                        {src && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleSelect(src.schema, src.relation)}
                          >
                            {src.schema}.{src.relation}
                          </button>
                        )}
                      </td>
                      <td>{e.sourceColumns.join(', ')}</td>
                      <td>
                        {tgt && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleSelect(tgt.schema, tgt.relation)}
                          >
                            {tgt.schema}.{tgt.relation}
                          </button>
                        )}
                      </td>
                      <td>{e.targetColumns.join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </details>
    </div>
  );
}
