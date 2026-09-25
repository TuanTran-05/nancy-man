import {
  isDatabasePageSize,
  type DatabaseCell,
  type DatabaseExplorerSchemaSnapshot,
  type DatabaseRowsRequest,
  type DatabaseRowsResponse
} from '../../../../packages/contracts/src/databaseExplorer.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import {
  CURSOR_EXPIRY_MS,
  decodeCursor,
  encodeCursor,
  encodeRowRef,
  type KeysetCursorData,
  type OffsetCursorData
} from './cursorCodec.js';
import { buildRowsQuery, makeExplorerError } from './filterSql.js';
import { quoteIdentifier } from './identifier.js';
import { encodeCell, encodeRowPage, type EncodedRow } from './valueEncoding.js';

export type ReadDatabaseRowsInput = {
  target: AvailableTargetEntry;
  snapshot: DatabaseExplorerSchemaSnapshot;
  cursorKey: string;
  request: DatabaseRowsRequest;
  now?: () => Date;
};

export async function readDatabaseRows(
  input: ReadDatabaseRowsInput
): Promise<DatabaseRowsResponse> {
  const { request, snapshot, target, cursorKey } = input;
  const now = input.now ?? (() => new Date());

  if (!isDatabasePageSize(request.pageSize)) {
    throw makeExplorerError(
      'DATABASE_PAGE_TOO_LARGE',
      `Invalid page size: ${request.pageSize}. Allowed page sizes: 25, 50, 100`
    );
  }

  const schemaObj = snapshot.schemas.find((s) => s.name === request.schema);
  if (!schemaObj) {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      `Schema "${request.schema}" does not exist in target`
    );
  }

  const relationObj = schemaObj.relations.find((r) => r.name === request.relation);
  if (!relationObj) {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      `Relation "${request.relation}" does not exist in schema "${request.schema}"`
    );
  }

  if (!relationObj.dataAvailable) {
    throw makeExplorerError(
      'DATABASE_DATA_PERMISSION_DENIED',
      `Data browsing is not available for relation "${request.relation}"`
    );
  }

  // Handle cursor
  let decodedCursor: (KeysetCursorData | OffsetCursorData) | undefined;
  if (request.cursor) {
    decodedCursor = decodeCursor({
      encodedCursor: request.cursor,
      key: cursorKey,
      expected: {
        targetId: target.id,
        schema: request.schema,
        relation: request.relation,
        checksum: snapshot.checksum
      },
      now
    });
  }

  const hasPaginationKey = Boolean(
    relationObj.paginationKey && relationObj.paginationKey.length > 0
  );
  const consistency: 'stable' | 'best_effort' = hasPaginationKey ? 'stable' : 'best_effort';

  // Build cursor condition if keyset
  let cursorCondition: { predicate: string; values: unknown[] } | undefined;
  let offset: number | undefined;

  if (decodedCursor) {
    if (decodedCursor.kind === 'keyset') {
      const dir = (request.sort?.direction ?? 'asc').toUpperCase();
      const op = dir === 'DESC' ? '<' : '>';
      const colNames: string[] = [];
      const placeholders: string[] = [];
      const values: unknown[] = [];

      for (let i = 0; i < decodedCursor.keys.length; i++) {
        const item = decodedCursor.keys[i];
        colNames.push(quoteIdentifier(item.column));
        placeholders.push(`$${i + 1}`); // buildRowsQuery will offset parameter indexes
        values.push(item.value);
      }

      if (colNames.length === 1) {
        cursorCondition = {
          predicate: `${colNames[0]} ${op} $__CURSOR_PARAM_0__`,
          values
        };
      } else if (colNames.length > 1) {
        cursorCondition = {
          predicate: `(${colNames.join(', ')}) ${op} (${colNames.map((_, i) => `$__CURSOR_PARAM_${i}__`).join(', ')})`,
          values
        };
      }
    } else if (decodedCursor.kind === 'offset') {
      offset = decodedCursor.offset;
    }
  }

  // Build query
  const built = buildRowsQuery({
    snapshot,
    schema: request.schema,
    relation: request.relation,
    pageSize: request.pageSize,
    filters: request.filters,
    sort: request.sort,
    cursorCondition: cursorCondition
      ? {
          predicate: cursorCondition.predicate,
          values: cursorCondition.values
        }
      : undefined,
    offset
  });

  // Execute in read-only transaction with timeouts
  let connection;
  try {
    connection = await target.pool.connect();
  } catch (err: any) {
    if (!err.code) err.code = 'DATABASE_TARGET_UNAVAILABLE';
    throw err;
  }

  let queryRows: any[] = [];
  try {
    await connection.query('BEGIN READ ONLY');
    await connection.query("SET LOCAL statement_timeout = '15s'");
    await connection.query("SET LOCAL lock_timeout = '2s'");

    // Replace placeholder tags in cursorCondition predicate with actual parameter indexes if used
    let finalSql = built.text;
    const finalValues = [...built.values];

    // Note: buildRowsQuery already integrates cursorCondition with proper values!
    // But if cursorCondition used placeholder tags, let's ensure correct parameter indexes:
    if (cursorCondition) {
      // Find the starting index for cursor parameters in built.values
      const startIndex = built.values.length - cursorCondition.values.length + 1;
      for (let i = 0; i < cursorCondition.values.length; i++) {
        finalSql = finalSql.replace(`$__CURSOR_PARAM_${i}__`, `$${startIndex + i}`);
      }
    }

    const result = await connection.query(finalSql, finalValues);
    queryRows = result.rows;
  } catch (err: any) {
    if (err.code === '57014' || /timeout|canceling statement/i.test(err.message)) {
      throw makeExplorerError('DATABASE_QUERY_TIMEOUT', 'Database query timed out');
    }
    throw err;
  } finally {
    try {
      await connection.query('ROLLBACK');
    } catch {
      // Ignore rollback failure
    }
    connection.release();
  }

  const hasMore = queryRows.length > request.pageSize;
  const pageRows = hasMore ? queryRows.slice(0, request.pageSize) : queryRows;

  // Compute next cursor
  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const lastRow = pageRows[pageRows.length - 1];
    const issuedAt = now().getTime();
    const expiresAt = issuedAt + CURSOR_EXPIRY_MS;

    if (consistency === 'stable' && relationObj.paginationKey) {
      const keys: Array<{ column: string; value: unknown }> = [];
      if (request.sort && !relationObj.paginationKey.includes(request.sort.column)) {
        keys.push({ column: request.sort.column, value: lastRow[request.sort.column] });
      }
      for (const pkCol of relationObj.paginationKey) {
        keys.push({ column: pkCol, value: lastRow[pkCol] });
      }

      nextCursor = encodeCursor(
        {
          version: 1,
          kind: 'keyset',
          targetId: target.id,
          schema: request.schema,
          relation: request.relation,
          checksum: snapshot.checksum,
          issuedAt,
          expiresAt,
          sort: request.sort ?? null,
          keys
        },
        cursorKey
      );
    } else {
      const currentOffset =
        decodedCursor && decodedCursor.kind === 'offset' ? decodedCursor.offset : 0;
      const nextOffset = currentOffset + request.pageSize;
      if (nextOffset <= 10_000) {
        nextCursor = encodeCursor(
          {
            version: 1,
            kind: 'offset',
            targetId: target.id,
            schema: request.schema,
            relation: request.relation,
            checksum: snapshot.checksum,
            issuedAt,
            expiresAt,
            offset: nextOffset
          },
          cursorKey
        );
      }
    }
  }

  // Encode rows and cells
  const encodedRows: EncodedRow[] = [];
  for (const row of pageRows) {
    const cells: Record<string, DatabaseCell> = {};
    for (const col of relationObj.columns) {
      cells[col.name] = encodeCell({
        columnName: col.name,
        column: col,
        rawValue: row[col.name],
        piiMode: request.piiMode
      });
    }

    let rowRef: string | null = null;
    if (relationObj.paginationKey && relationObj.paginationKey.length > 0) {
      const refKeys: Record<string, unknown> = {};
      for (const pkCol of relationObj.paginationKey) {
        refKeys[pkCol] = row[pkCol];
      }
      rowRef = encodeRowRef(
        {
          version: 1,
          targetId: target.id,
          schema: request.schema,
          relation: request.relation,
          checksum: snapshot.checksum,
          keys: refKeys
        },
        cursorKey
      );
    }

    encodedRows.push({ rowRef, cells });
  }

  const rowPageResult = encodeRowPage(encodedRows);

  return {
    targetId: target.id,
    schemaChecksum: snapshot.checksum,
    policyVersion: snapshot.policyVersion,
    schema: request.schema,
    relation: request.relation,
    columns: relationObj.columns,
    rows: rowPageResult.rows,
    nextCursor,
    truncated: rowPageResult.truncated,
    encodedBytes: rowPageResult.encodedBytes,
    consistency,
    piiMode: request.piiMode
  };
}
