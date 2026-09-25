import type {
  DatabaseExplorerSchemaSnapshot,
  DatabaseFilterOperator,
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
    }
  });

  const edge = snapshot.edges.find((e) => e.constraint === request.constraint);
  if (!edge) {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      `Foreign key constraint "${request.constraint}" not found in schema snapshot`
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

  const filters: Array<{ column: string; operator: DatabaseFilterOperator; value: string }> = [];
  for (let i = 0; i < targetCols.length; i++) {
    const tCol = targetCols[i];
    const sCol = sourceCols[i];
    if (!tCol || !sCol) continue;
    const val = rowRefData.keys[sCol];
    if (val === undefined || val === null) {
      throw makeExplorerError(
        'DATABASE_RELATION_INVALID',
        `Row reference does not contain required key column "${sCol}" for foreign key traversal`
      );
    }
    filters.push({
      column: tCol,
      operator: 'eq',
      value: String(val)
    });
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
      filters,
      piiMode: request.piiMode
    },
    ...(now ? { now } : {})
  });
}
