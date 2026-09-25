import { describe, expect, it } from 'vitest';
import { buildRowsQuery } from './filterSql.js';
import type { DatabaseExplorerSchemaSnapshot } from '../../../../packages/contracts/src/databaseExplorer.js';

function createSnapshotFixture(
  options: {
    schemaName?: string;
    relationName?: string;
    columnNames?: string[];
    blockedColumns?: string[];
    paginationKey?: string[] | null;
  } = {}
): DatabaseExplorerSchemaSnapshot {
  const schemaName = options.schemaName ?? 'public';
  const relationName = options.relationName ?? 'students';
  const columnNames = options.columnNames ?? [
    'id',
    'email',
    'age',
    'created_at',
    'is_active',
    'secret_token'
  ];
  const blockedColumns = new Set(options.blockedColumns ?? ['secret_token']);

  return {
    targetId: 'edutrack_production',
    targetLabel: 'EduTrack Production',
    checksum: 'mock_checksum',
    policyVersion: '2026-09-25-v2',
    edges: [],
    schemas: [
      {
        name: schemaName,
        relations: [
          {
            name: relationName,
            kind: 'table',
            rowLevelSecurity: { enabled: false, forced: false },
            dataAvailable: true,
            estimatedRows: 100,
            primaryKey: ['id'],
            paginationKey: options.paginationKey !== undefined ? options.paginationKey : ['id'],
            constraints: [],
            indexes: [],
            triggers: [],
            policies: [],
            columns: columnNames.map((name) => {
              const isBlocked = blockedColumns.has(name);
              const dataType = name.includes('age')
                ? 'integer'
                : name.includes('created_at')
                  ? 'timestamptz'
                  : name.includes('is_active')
                    ? 'boolean'
                    : 'text';

              return {
                name,
                dataType,
                nullable: false,
                hasDefault: false,
                identity: null,
                generated: false,
                classification: isBlocked ? 'blocked' : name === 'email' ? 'pii' : 'internal',
                selectable: !isBlocked,
                filterOperators: isBlocked
                  ? []
                  : dataType === 'integer' || dataType === 'timestamptz'
                    ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']
                    : dataType === 'boolean'
                      ? ['eq', 'neq', 'is_null', 'is_not_null']
                      : ['eq', 'neq', 'contains', 'is_null', 'is_not_null']
              };
            })
          }
        ]
      }
    ]
  };
}

describe('buildRowsQuery and buildFilterSql', () => {
  it('quotes only snapshot-resolved identifiers and parameterizes values', () => {
    const snapshot = createSnapshotFixture({
      schemaName: 'Odd Schema',
      relationName: 'select',
      columnNames: ['display"name', 'secret_token'],
      blockedColumns: ['secret_token']
    });

    const built = buildRowsQuery({
      snapshot,
      schema: 'Odd Schema',
      relation: 'select',
      pageSize: 25,
      filters: [{ column: 'display"name', operator: 'eq', value: "x' OR true --" }]
    });

    expect(built.text).toContain('"Odd Schema"."select"');
    expect(built.text).toContain('"display""name" = $1');
    expect(built.text).not.toContain("x' OR true --");
    expect(built.values).toEqual(["x' OR true --"]);
  });

  it('excludes blocked columns from SELECT column list', () => {
    const snapshot = createSnapshotFixture();
    const built = buildRowsQuery({
      snapshot,
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: []
    });

    expect(built.text).not.toContain('"secret_token"');
    expect(built.selectableColumns).not.toContain('secret_token');
    expect(built.selectableColumns).toContain('id');
    expect(built.selectableColumns).toContain('email');
  });

  it('orders by the requested sort followed by the complete stable key with explicit null order', () => {
    const snapshot = createSnapshotFixture({
      columnNames: ['tenant_id', 'id', 'display_name', 'secret_token'],
      paginationKey: ['tenant_id', 'id']
    });

    const built = buildRowsQuery({
      snapshot,
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [],
      sort: { column: 'display_name', direction: 'desc' }
    });

    expect(built.text).toContain(
      'ORDER BY "display_name" DESC NULLS LAST, "tenant_id" DESC NULLS LAST, "id" DESC NULLS LAST'
    );
  });

  it('rejects filtering on a blocked column with DATABASE_FILTER_INVALID', () => {
    const snapshot = createSnapshotFixture();
    expect(() =>
      buildRowsQuery({
        snapshot,
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [{ column: 'secret_token', operator: 'eq', value: 'secret' }]
      })
    ).toThrowError(/DATABASE_FILTER_INVALID/);
  });

  it('rejects an identifier not present in the snapshot with DATABASE_COLUMN_INVALID', () => {
    const snapshot = createSnapshotFixture();
    expect(() =>
      buildRowsQuery({
        snapshot,
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [{ column: 'non_existent_col', operator: 'eq', value: 'val' }]
      })
    ).toThrowError(/DATABASE_COLUMN_INVALID/);
  });

  it('rejects relations not present in the snapshot with DATABASE_RELATION_INVALID', () => {
    const snapshot = createSnapshotFixture();
    expect(() =>
      buildRowsQuery({
        snapshot,
        schema: 'public',
        relation: 'non_existent_table',
        pageSize: 25,
        filters: []
      })
    ).toThrowError(/DATABASE_RELATION_INVALID/);
  });

  it('enforces limit of at most 5 filters', () => {
    const snapshot = createSnapshotFixture();
    const filters = [
      { column: 'id', operator: 'eq' as const, value: '1' },
      { column: 'email', operator: 'eq' as const, value: 'a' },
      { column: 'age', operator: 'gt' as const, value: '20' },
      { column: 'created_at', operator: 'gte' as const, value: '2026-01-01' },
      { column: 'is_active', operator: 'eq' as const, value: 'true' },
      { column: 'email', operator: 'contains' as const, value: 'extra' }
    ];

    expect(() =>
      buildRowsQuery({
        snapshot,
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters
      })
    ).toThrowError(/DATABASE_FILTER_INVALID/);
  });

  it('enforces limit of at most 200 characters per filter value', () => {
    const snapshot = createSnapshotFixture();
    expect(() =>
      buildRowsQuery({
        snapshot,
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [{ column: 'email', operator: 'eq', value: 'x'.repeat(201) }]
      })
    ).toThrowError(/DATABASE_FILTER_INVALID/);
  });

  it('supports null operators without parameters and rejects missing values for comparison operators', () => {
    const snapshot = createSnapshotFixture();
    const built = buildRowsQuery({
      snapshot,
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [
        { column: 'email', operator: 'is_null' },
        { column: 'age', operator: 'is_not_null' }
      ]
    });

    expect(built.text).toContain('"email" IS NULL');
    expect(built.text).toContain('"age" IS NOT NULL');
    expect(built.values).toEqual([]);

    expect(() =>
      buildRowsQuery({
        snapshot,
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [{ column: 'email', operator: 'eq' }]
      })
    ).toThrowError(/DATABASE_FILTER_INVALID/);
  });

  it('rejects unsupported operator/type combinations with DATABASE_FILTER_INVALID', () => {
    const snapshot = createSnapshotFixture();
    // boolean doesn't support 'gt'
    expect(() =>
      buildRowsQuery({
        snapshot,
        schema: 'public',
        relation: 'students',
        pageSize: 25,
        filters: [{ column: 'is_active', operator: 'gt', value: 'true' }]
      })
    ).toThrowError(/DATABASE_FILTER_INVALID/);
  });

  it('handles Unicode filter values correctly', () => {
    const snapshot = createSnapshotFixture();
    const unicodeValue = 'Nguyễn Văn A 🇻🇳';
    const built = buildRowsQuery({
      snapshot,
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [{ column: 'email', operator: 'contains', value: unicodeValue }]
    });

    expect(built.values).toEqual([unicodeValue]);
    expect(built.text).toContain("\"email\"::text ILIKE ('%' || $1 || '%')");
  });

  it('generates comparison operators for numbers and dates', () => {
    const snapshot = createSnapshotFixture();
    const built = buildRowsQuery({
      snapshot,
      schema: 'public',
      relation: 'students',
      pageSize: 25,
      filters: [
        { column: 'age', operator: 'gte', value: '18' },
        { column: 'created_at', operator: 'lt', value: '2026-09-01' }
      ]
    });

    expect(built.text).toContain('"age" >= $1');
    expect(built.text).toContain('"created_at" < $2');
    expect(built.values).toEqual(['18', '2026-09-01']);
  });
});
