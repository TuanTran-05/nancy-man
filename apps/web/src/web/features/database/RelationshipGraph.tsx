import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DatabaseExplorerSchemaSnapshot } from '../../../../../packages/contracts/src/databaseExplorer.js';
import {
  applyDagreLayout,
  makeNodeId,
  projectFocusedGraph,
  type GraphEdge,
  type GraphRelationNode
} from './graphModel.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type RelationshipGraphProps = {
  snapshot: DatabaseExplorerSchemaSnapshot;
  targetId: string;
  selectedSchema: string;
  selectedRelation: string;
  onSelectRelation: (schema: string, relation: string) => void;
};

// ---------------------------------------------------------------------------
// React Flow custom node
// ---------------------------------------------------------------------------

type RelationNodeData = {
  label: string;
  schema: string;
  relation: string;
  isSelected: boolean;
  primaryKey: string[] | null;
  columns: Array<{ name: string; dataType: string; isFk: boolean }>;
  onSelect: (schema: string, relation: string) => void;
};

function RelationNode({ data }: { data: RelationNodeData }) {
  return (
    <div
      className={`graph-node ${data.isSelected ? 'graph-node--selected' : ''}`}
      onClick={() => data.onSelect(data.schema, data.relation)}
      role="button"
      tabIndex={0}
      aria-pressed={data.isSelected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onSelect(data.schema, data.relation);
        }
      }}
    >
      <div className="graph-node-header">
        <span className="graph-node-schema">{data.schema}</span>
        <span className="graph-node-name">{data.relation}</span>
      </div>
      <ul className="graph-node-columns">
        {data.columns.slice(0, 8).map((c) => (
          <li
            key={c.name}
            className={`graph-node-col ${c.isFk ? 'graph-node-col--fk' : ''} ${data.primaryKey?.includes(c.name) ? 'graph-node-col--pk' : ''}`}
          >
            <span className="graph-col-name">{c.name}</span>
            <span className="graph-col-type">{c.dataType}</span>
          </li>
        ))}
        {data.columns.length > 8 && (
          <li className="graph-node-col graph-node-col--more">
            +{data.columns.length - 8} cột nữa
          </li>
        )}
      </ul>
    </div>
  );
}

const nodeTypes = { relation: RelationNode };

// ---------------------------------------------------------------------------
// Convert GraphModel → React Flow nodes/edges
// ---------------------------------------------------------------------------

function toFlowNodes(
  nodes: GraphRelationNode[],
  selectedId: string,
  onSelect: (schema: string, relation: string) => void
) {
  return nodes.map((n) => ({
    id: n.id,
    type: 'relation' as const,
    position: { x: n.x, y: n.y },
    data: {
      label: `${n.schema}.${n.relation}`,
      schema: n.schema,
      relation: n.relation,
      isSelected: n.id === selectedId,
      primaryKey: n.primaryKey,
      columns: n.columns,
      onSelect
    } satisfies RelationNodeData,
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

export function RelationshipGraph({
  snapshot,
  targetId,
  selectedSchema,
  selectedRelation,
  onSelectRelation
}: RelationshipGraphProps) {
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(new Set());

  const selectedId = makeNodeId(targetId, selectedSchema, selectedRelation);

  // Recompute focused graph whenever selection or snapshot changes
  const graphModel = useMemo(() => {
    const model = projectFocusedGraph(
      snapshot,
      targetId,
      selectedSchema,
      selectedRelation,
      expandedNodeIds
    );
    applyDagreLayout(model.nodes, model.edges, 'LR');
    return model;
  }, [snapshot, targetId, selectedSchema, selectedRelation, expandedNodeIds]);

  const isEmpty = graphModel.edges.length === 0 && graphModel.nodes.length <= 1;

  const handleSelect = useCallback(
    (schema: string, relation: string) => {
      onSelectRelation(schema, relation);
    },
    [onSelectRelation]
  );

  const flowNodes = useMemo(
    () => toFlowNodes(graphModel.nodes, selectedId, handleSelect),
    [graphModel.nodes, selectedId, handleSelect]
  );
  const flowEdges = useMemo(() => toFlowEdges(graphModel.edges), [graphModel.edges]);

  const [nodes, , onNodesChange] = useNodesState(flowNodes);
  const [edges, , onEdgesChange] = useEdgesState(flowEdges);

  // Sync nodes/edges when model changes
  useEffect(() => {
    onNodesChange(flowNodes.map((n) => ({ type: 'reset' as const, item: n })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowNodes]);

  useEffect(() => {
    onEdgesChange(flowEdges.map((e) => ({ type: 'reset' as const, item: e })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowEdges]);

  const handleReset = useCallback(() => {
    setExpandedNodeIds(new Set());
  }, []);

  if (isEmpty) {
    return (
      <div className="graph-empty-state">
        <p>Không có quan hệ khóa ngoại nào cho bảng này.</p>
      </div>
    );
  }

  return (
    <div className="relationship-graph-container">
      {/* Graph controls */}
      <div className="graph-controls-bar">
        <span className="graph-info">
          {graphModel.nodes.length} bảng · {graphModel.edges.length} quan hệ
        </span>
        <button type="button" className="secondary-button compact" onClick={handleReset}>
          Reset zoom
        </button>
      </div>

      {/* React Flow canvas */}
      <div className="graph-canvas-wrapper" aria-hidden="true">
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
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {/* Accessible semantic table — same data, keyboard + screen-reader friendly */}
      <details className="graph-a11y-details">
        <summary>Danh sách quan hệ (dành cho bàn phím / screen reader)</summary>
        <table className="graph-a11y-table" aria-label="Danh sách quan hệ">
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
            {graphModel.edges.map((e) => {
              const srcNode = graphModel.nodes.find((n) => n.id === e.sourceNodeId);
              const tgtNode = graphModel.nodes.find((n) => n.id === e.targetNodeId);
              return (
                <tr key={e.id}>
                  <td>{e.constraint}</td>
                  <td>
                    {srcNode && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleSelect(srcNode.schema, srcNode.relation)}
                        aria-label={`Chọn ${srcNode.schema}.${srcNode.relation}`}
                      >
                        {srcNode.schema}.{srcNode.relation}
                      </button>
                    )}
                  </td>
                  <td>{e.sourceColumns.join(', ')}</td>
                  <td>
                    {tgtNode && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleSelect(tgtNode.schema, tgtNode.relation)}
                        aria-label={`Chọn ${tgtNode.schema}.${tgtNode.relation}`}
                      >
                        {tgtNode.schema}.{tgtNode.relation}
                      </button>
                    )}
                  </td>
                  <td>{e.targetColumns.join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
