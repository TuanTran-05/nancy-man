import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseRelatedRowsRequest,
  DatabaseRowsResponse
} from '../../../../packages/contracts/src/databaseExplorer.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import { decodeRowRef } from './cursorCodec.js';
import { makeExplorerError } from './filterSql.js';
import { readDatabaseRows } from './rowReader.js';

export type ReadRelatedRowsInput = {
  target: AvailableTargetEntry;
  snapshot: DatabaseExplorerSchemaSnapshot;
  cursorKey: string;
  request: DatabaseRelatedRowsRequest;
  now?: () => Date;
};

export async function readRelatedRows(input: ReadRelatedRowsInput): Promise<DatabaseRowsResponse> {
  const { request, snapshot, target, cursorKey, now } = input;

  const rowRefData = decodeRowRef({
    encodedRowRef: request.rowRef,
    key: cursorKey,
    expected: {
      targetId: target.id,
      schema: request.schema,
      relation: request.relation,
      checksum: snapshot.checksum
    },
    ...(now ? { now } : {})
  });

  const matchingEdges = snapshot.edges.filter((e) => e.constraint === request.constraint);
  const edge = matchingEdges.find(
    (candidate) =>
      (candidate.from.schema === request.schema && candidate.from.relation === request.relation) ||
      (candidate.to.schema === request.schema && candidate.to.relation === request.relation)
  );
  if (!edge) {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      matchingEdges.length === 0
        ? `Foreign key constraint "${request.constraint}" not found in schema snapshot`
        : `Constraint "${request.constraint}" does not connect to relation "${request.schema}.${request.relation}"`
    );
  }

  let targetSchema: string;
  let targetRelation: string;
  let targetCols: string[];
  let sourceCols: string[];

  if (edge.from.schema === request.schema && edge.from.relation === request.relation) {
    // Source is child table with FK pointing to parent table
    targetSchema = edge.to.schema;
    targetRelation = edge.to.relation;
    targetCols = edge.to.columns;
    sourceCols = edge.from.columns;
  } else if (edge.to.schema === request.schema && edge.to.relation === request.relation) {
    // Source is parent table referenced by child table's FK
    targetSchema = edge.from.schema;
    targetRelation = edge.from.relation;
    targetCols = edge.from.columns;
    sourceCols = edge.to.columns;
  } else {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      `Constraint "${request.constraint}" does not connect to relation "${request.schema}.${request.relation}"`
    );
  }

  if (sourceCols.length === 0 || sourceCols.length !== targetCols.length) {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      `Constraint "${request.constraint}" has invalid column pairing`
    );
  }

  const trustedEqualities: Array<{ column: string; value: unknown }> = [];
  for (let i = 0; i < targetCols.length; i++) {
    const tCol = targetCols[i];
    const sCol = sourceCols[i];
    if (!tCol || !sCol) {
      throw makeExplorerError(
        'DATABASE_RELATION_INVALID',
        `Constraint "${request.constraint}" has invalid column pairing`
      );
    }
    const val = rowRefData.keys[sCol];
    if (val === undefined || val === null) {
      throw makeExplorerError(
        'DATABASE_RELATION_INVALID',
        `Row reference does not contain required key column "${sCol}" for foreign key traversal`
      );
    }
    trustedEqualities.push({ column: tCol, value: val });
  }

  return readDatabaseRows({
    target,
    snapshot,
    cursorKey,
    request: {
      targetId: request.targetId,
      schema: targetSchema,
      relation: targetRelation,
      pageSize: request.pageSize,
      ...(request.cursor ? { cursor: request.cursor } : {}),
      filters: [],
      piiMode: request.piiMode
    },
    trustedEqualities,
    ...(now ? { now } : {})
  });
}
