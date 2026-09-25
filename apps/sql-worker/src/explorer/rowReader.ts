import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import {
  isDatabasePageSize,
  type DatabaseCell,
  type DatabaseExplorerSchemaSnapshot,
  type DatabaseRowsRequest,
  type DatabaseRowsResponse
} from '../../../../packages/contracts/src/databaseExplorer.js';
import type { AvailableTargetEntry } from '../database/targetRegistry.js';
import { readProductionSchema } from '../schema/introspectSchema.js';
import {
  CURSOR_EXPIRY_MS,
  decodeCursor,
  encodeCursor,
  encodeRowRef,
  type KeysetCursorData,
  type OffsetCursorData
} from './cursorCodec.js';
import { buildRowsQuery, makeExplorerError } from './filterSql.js';
import { invalidateExplorerSchemaCache } from './schemaReader.js';
import { quoteIdentifier } from './identifier.js';
import { encodeCell, encodeRowPage, type EncodedRow } from './valueEncoding.js';

function sameSort(
  stored: { column: string; direction: 'asc' | 'desc' } | null,
  requested: { column: string; direction: 'asc' | 'desc' } | undefined
): boolean {
  if (stored === null || requested === undefined) return stored === null && requested === undefined;
  return stored.column === requested.column && stored.direction === requested.direction;
}

function getCursorKeyColumns(
  sort: { column: string; direction: 'asc' | 'desc' } | undefined,
  paginationKey: string[]
): string[] {
  const columns = sort ? [sort.column] : [];
  for (const column of paginationKey) {
    if (!columns.includes(column)) columns.push(column);
  }
  return columns;
}

function buildKeysetCondition(
  keys: Array<{ column: string; value: unknown }>,
  direction: 'asc' | 'desc'
): { predicate: string; values: unknown[] } {
  const values: unknown[] = [];
  const terms: string[] = [];
  const operator = direction === 'desc' ? '<' : '>';
  const parameter = (value: unknown): string => {
    const index = values.length;
    values.push(value);
    return `$__CURSOR_PARAM_${index}__`;
  };

  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const column = quoteIdentifier(key.column);
    const prefix: string[] = [];
    for (let prefixIndex = 0; prefixIndex < index; prefixIndex++) {
      const prefixKey = keys[prefixIndex]!;
      const prefixColumn = quoteIdentifier(prefixKey.column);
      prefix.push(
        prefixKey.value === null
          ? `${prefixColumn} IS NULL`
          : `${prefixColumn} = ${parameter(prefixKey.value)}`
      );
    }

    // With NULLS LAST, no value follows a null at this component; later key
    // components still continue rows tied on that null value.
    if (key.value === null) continue;
    const comparison = `(${column} ${operator} ${parameter(key.value)} OR ${column} IS NULL)`;
    terms.push(prefix.length > 0 ? `(${prefix.join(' AND ')} AND ${comparison})` : comparison);
  }

  return {
    predicate: terms.length > 0 ? `(${terms.join(' OR ')})` : 'FALSE',
    values
  };
}

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

  if (request.targetId !== target.id || snapshot.targetId !== target.id) {
    throw makeExplorerError('DATABASE_TARGET_INVALID');
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

  let schemaConnection;
  let liveChecksum: string;
  try {
    schemaConnection = await target.pool.connect();
    const liveSchema = await readProductionSchema({ database: schemaConnection });
    liveChecksum = liveSchema.checksum;
  } catch {
    const error = makeExplorerError('DATABASE_SCHEMA_CHECK_FAILED');
    captureOpsException(error, {
      code: 'DATABASE_SCHEMA_CHECK_FAILED',
      source: 'database',
      status: 500
    });
    throw error;
  } finally {
    schemaConnection?.release();
  }
  if (liveChecksum !== snapshot.checksum) {
    invalidateExplorerSchemaCache(target);
    throw makeExplorerError('DATABASE_SCHEMA_STALE');
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
    if (decodedCursor.nullOrder !== 'last' || !sameSort(decodedCursor.sort, request.sort)) {
      throw makeExplorerError('DATABASE_CURSOR_INVALID');
    }
    if (decodedCursor.kind === 'keyset') {
      const paginationKey = relationObj.paginationKey;
      if (!paginationKey || paginationKey.length === 0) {
        throw makeExplorerError('DATABASE_CURSOR_INVALID');
      }
      const expectedKeys = getCursorKeyColumns(request.sort, paginationKey);
      if (
        decodedCursor.keys.length !== expectedKeys.length ||
        decodedCursor.keys.some((key, index) => key.column !== expectedKeys[index])
      ) {
        throw makeExplorerError('DATABASE_CURSOR_INVALID');
      }
    }
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
      cursorCondition = buildKeysetCondition(decodedCursor.keys, request.sort?.direction ?? 'asc');
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
    ...(request.sort ? { sort: request.sort } : {}),
    ...(cursorCondition
      ? {
          cursorCondition: {
            predicate: cursorCondition.predicate,
            values: cursorCondition.values
          }
        }
      : {}),
    ...(offset !== undefined ? { offset } : {})
  });

  // Execute in read-only transaction with timeouts
  let connection;
  try {
    connection = await target.pool.connect();
  } catch {
    const error = makeExplorerError('DATABASE_TARGET_UNAVAILABLE');
    captureOpsException(error, {
      code: 'DATABASE_TARGET_UNAVAILABLE',
      source: 'database',
      status: 500
    });
    throw error;
  }

  let queryRows: Record<string, unknown>[];
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

    const result = await connection.query<Record<string, unknown>>(finalSql, finalValues);
    queryRows = result.rows;
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
    const message = typeof errObj['message'] === 'string' ? errObj['message'] : '';
    if (errObj['code'] === '57014' || /timeout|canceling statement/i.test(message)) {
      const error = makeExplorerError('DATABASE_QUERY_TIMEOUT');
      captureOpsException(error, {
        code: 'DATABASE_QUERY_TIMEOUT',
        source: 'database',
        status: 500
      });
      throw error;
    }
    const error = makeExplorerError('DATABASE_QUERY_FAILED');
    captureOpsException(error, {
      code: 'DATABASE_QUERY_FAILED',
      source: 'database',
      status: 500
    });
    throw error;
  } finally {
    try {
      await connection.query('ROLLBACK');
    } catch {
      captureOpsException(makeExplorerError('DATABASE_ROLLBACK_FAILED'), {
        code: 'DATABASE_ROLLBACK_FAILED',
        source: 'database',
        status: 500
      });
      // Ignore rollback failure
    }
    connection.release();
  }

  const hasMore = queryRows.length > request.pageSize;
  const pageRows = hasMore ? queryRows.slice(0, request.pageSize) : queryRows;

  // Compute next cursor
  let nextCursor: string | null = null;
  const lastRow = pageRows[pageRows.length - 1];
  if (hasMore && lastRow) {
    const issuedAt = now().getTime();
    const expiresAt = issuedAt + CURSOR_EXPIRY_MS;

    if (consistency === 'stable' && relationObj.paginationKey) {
      const keys = getCursorKeyColumns(request.sort, relationObj.paginationKey).map((column) => ({
        column,
        value: lastRow[column]
      }));

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
          nullOrder: 'last',
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
            offset: nextOffset,
            sort: request.sort ?? null,
            nullOrder: 'last'
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
      const rowRefIssuedAt = now().getTime();
      rowRef = encodeRowRef(
        {
          version: 1,
          targetId: target.id,
          schema: request.schema,
          relation: request.relation,
          checksum: snapshot.checksum,
          issuedAt: rowRefIssuedAt,
          expiresAt: rowRefIssuedAt + CURSOR_EXPIRY_MS,
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
