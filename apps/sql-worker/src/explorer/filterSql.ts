import type {
  DatabaseExplorerColumn,
  DatabaseExplorerRelation,
  DatabaseExplorerSchemaSnapshot,
  DatabaseFilterOperator,
  DatabasePageSize
} from '../../../../packages/contracts/src/databaseExplorer.js';
import { quoteIdentifier } from './identifier.js';

export function makeExplorerError(code: string, message?: string): Error {
  const err = new Error(message ? `${code}: ${message}` : code);
  (err as unknown as { code: string }).code = code;
  return err;
}

export type FilterPredicate = {
  column: string;
  operator: DatabaseFilterOperator;
  value?: string;
};

export type BuildFilterSqlInput = {
  columns: DatabaseExplorerColumn[];
  filters: FilterPredicate[];
  startParamIndex?: number;
};

export type BuildFilterSqlResult = {
  predicates: string[];
  values: unknown[];
  nextParamIndex: number;
};

export function buildFilterSql(input: BuildFilterSqlInput): BuildFilterSqlResult {
  if (input.filters.length > 5) {
    throw makeExplorerError('DATABASE_FILTER_INVALID', 'At most 5 filters are allowed');
  }

  const columnMap = new Map<string, DatabaseExplorerColumn>();
  for (const col of input.columns) {
    columnMap.set(col.name, col);
  }

  const predicates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = input.startParamIndex ?? 1;

  for (const filter of input.filters) {
    const col = columnMap.get(filter.column);
    if (!col) {
      throw makeExplorerError(
        'DATABASE_COLUMN_INVALID',
        `Column "${filter.column}" not found in relation`
      );
    }

    if (col.classification === 'blocked' || !col.selectable) {
      throw makeExplorerError(
        'DATABASE_FILTER_INVALID',
        `Filtering on blocked column "${filter.column}" is forbidden`
      );
    }

    if (!col.filterOperators.includes(filter.operator)) {
      throw makeExplorerError(
        'DATABASE_FILTER_INVALID',
        `Operator "${filter.operator}" is not supported for column "${filter.column}"`
      );
    }

    const colQuoted = quoteIdentifier(col.name);

    if (filter.operator === 'is_null') {
      predicates.push(`${colQuoted} IS NULL`);
      continue;
    }

    if (filter.operator === 'is_not_null') {
      predicates.push(`${colQuoted} IS NOT NULL`);
      continue;
    }

    if (filter.value === undefined || filter.value === null) {
      throw makeExplorerError(
        'DATABASE_FILTER_INVALID',
        `Value is required for operator "${filter.operator}" on column "${filter.column}"`
      );
    }

    if (typeof filter.value !== 'string') {
      throw makeExplorerError('DATABASE_FILTER_INVALID', `Filter value must be a string`);
    }

    if (filter.value.length > 200) {
      throw makeExplorerError(
        'DATABASE_FILTER_INVALID',
        `Filter value exceeds maximum length of 200 characters`
      );
    }

    const placeholder = `$${paramIndex++}`;
    values.push(filter.value);

    switch (filter.operator) {
      case 'eq':
        predicates.push(`${colQuoted} = ${placeholder}`);
        break;
      case 'neq':
        predicates.push(`${colQuoted} != ${placeholder}`);
        break;
      case 'contains':
        predicates.push(`${colQuoted}::text ILIKE ('%' || ${placeholder} || '%')`);
        break;
      case 'gt':
        predicates.push(`${colQuoted} > ${placeholder}`);
        break;
      case 'gte':
        predicates.push(`${colQuoted} >= ${placeholder}`);
        break;
      case 'lt':
        predicates.push(`${colQuoted} < ${placeholder}`);
        break;
      case 'lte':
        predicates.push(`${colQuoted} <= ${placeholder}`);
        break;
    }
  }

  return { predicates, values, nextParamIndex: paramIndex };
}

export type BuildRowsQueryInput = {
  snapshot: DatabaseExplorerSchemaSnapshot;
  schema: string;
  relation: string;
  pageSize: DatabasePageSize;
  filters: FilterPredicate[];
  trustedEqualities?: Array<{ column: string; value: unknown }>;
  sort?: { column: string; direction: 'asc' | 'desc' };
  cursorCondition?: {
    predicate: string;
    values: unknown[];
  };
  offset?: number;
};

export type BuildRowsQueryResult = {
  text: string;
  values: unknown[];
  selectableColumns: string[];
  relation: DatabaseExplorerRelation;
};

export function buildRowsQuery(input: BuildRowsQueryInput): BuildRowsQueryResult {
  const schemaObj = input.snapshot.schemas.find((s) => s.name === input.schema);
  if (!schemaObj) {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      `Schema "${input.schema}" does not exist in target`
    );
  }

  const relationObj = schemaObj.relations.find((r) => r.name === input.relation);
  if (!relationObj) {
    throw makeExplorerError(
      'DATABASE_RELATION_INVALID',
      `Relation "${input.relation}" does not exist in schema "${input.schema}"`
    );
  }

  if (!relationObj.dataAvailable) {
    throw makeExplorerError('DATABASE_DATA_PERMISSION_DENIED');
  }

  const selectableCols = relationObj.columns.filter(
    (c) => c.selectable && c.classification !== 'blocked'
  );
  if (selectableCols.length === 0) {
    throw makeExplorerError(
      'DATABASE_DATA_PERMISSION_DENIED',
      `No selectable columns in relation "${input.relation}"`
    );
  }

  const selectableColumnNames = selectableCols.map((c) => c.name);

  // Validate sort
  if (input.sort) {
    const sortCol = selectableCols.find((c) => c.name === input.sort!.column);
    if (!sortCol) {
      throw makeExplorerError(
        'DATABASE_COLUMN_INVALID',
        `Sort column "${input.sort.column}" does not exist or is not selectable`
      );
    }
    if (input.sort.direction !== 'asc' && input.sort.direction !== 'desc') {
      throw makeExplorerError(
        'DATABASE_FILTER_INVALID',
        `Invalid sort direction "${input.sort.direction}"`
      );
    }
  }

  // Filters
  const filterResult = buildFilterSql({
    columns: relationObj.columns,
    filters: input.filters,
    startParamIndex: 1
  });

  const trustedPredicates: string[] = [];
  const trustedValues: unknown[] = [];
  let nextParamIndex = filterResult.nextParamIndex;
  for (const equality of input.trustedEqualities ?? []) {
    const column = relationObj.columns.find((candidate) => candidate.name === equality.column);
    if (!column) {
      throw makeExplorerError(
        'DATABASE_COLUMN_INVALID',
        `Column "${equality.column}" not found in relation`
      );
    }
    if (column.classification === 'blocked' || !column.selectable) {
      throw makeExplorerError(
        'DATABASE_FILTER_INVALID',
        `Filtering on blocked column "${equality.column}" is forbidden`
      );
    }
    if (equality.value === undefined || equality.value === null) {
      throw makeExplorerError(
        'DATABASE_FILTER_INVALID',
        `Value is required for trusted equality on column "${equality.column}"`
      );
    }

    trustedPredicates.push(`${quoteIdentifier(column.name)} = $${nextParamIndex++}`);
    trustedValues.push(equality.value);
  }

  const allPredicates = [...filterResult.predicates, ...trustedPredicates];
  const allValues = [...filterResult.values, ...trustedValues];

  // Keyset cursor condition
  if (input.cursorCondition) {
    allPredicates.push(input.cursorCondition.predicate);
    allValues.push(...input.cursorCondition.values);
    nextParamIndex += input.cursorCondition.values.length;
  }

  // Build query
  const selectClause = selectableCols.map((c) => quoteIdentifier(c.name)).join(', ');
  const fromClause = `${quoteIdentifier(input.schema)}.${quoteIdentifier(input.relation)}`;
  let queryText = `SELECT ${selectClause} FROM ${fromClause}`;

  if (allPredicates.length > 0) {
    queryText += ` WHERE ${allPredicates.join(' AND ')}`;
  }

  // Order By
  const orderItems: string[] = [];
  if (input.sort) {
    const dir = input.sort.direction.toUpperCase();
    orderItems.push(`${quoteIdentifier(input.sort.column)} ${dir} NULLS LAST`);
  }

  // If there's a pagination key, append its columns for deterministic tie-breaking
  if (relationObj.paginationKey && relationObj.paginationKey.length > 0) {
    const sortColName = input.sort?.column;
    const dir = input.sort?.direction ? input.sort.direction.toUpperCase() : 'ASC';
    for (const pkCol of relationObj.paginationKey) {
      if (pkCol !== sortColName) {
        orderItems.push(`${quoteIdentifier(pkCol)} ${dir} NULLS LAST`);
      }
    }
  }

  if (orderItems.length > 0) {
    queryText += ` ORDER BY ${orderItems.join(', ')}`;
  }

  // Limit (pageSize + 1 to check for next page)
  const limitValue = input.pageSize + 1;
  queryText += ` LIMIT ${limitValue}`;

  // Offset if offset pagination
  if (input.offset !== undefined && input.offset > 0) {
    if (input.offset > 10_000) {
      throw makeExplorerError('DATABASE_PAGE_TOO_LARGE');
    }
    const offsetPlaceholder = `$${nextParamIndex}`;
    queryText += ` OFFSET ${offsetPlaceholder}`;
    allValues.push(input.offset);
  }

  return {
    text: queryText,
    values: allValues,
    selectableColumns: selectableColumnNames,
    relation: relationObj
  };
}
