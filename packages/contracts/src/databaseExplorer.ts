import type {
  DatabaseConstraint,
  DatabaseIndex,
  DatabasePolicy,
  DatabaseTrigger
} from './databaseSchema.js';

export const DATABASE_TARGET_IDS = ['edutrack_production', 'ops'] as const;
export type DatabaseTargetId = (typeof DATABASE_TARGET_IDS)[number];

export function isDatabaseTargetId(value: unknown): value is DatabaseTargetId {
  return typeof value === 'string' && (DATABASE_TARGET_IDS as readonly string[]).includes(value);
}

export const DATABASE_PAGE_SIZES = [25, 50, 100] as const;
export type DatabasePageSize = (typeof DATABASE_PAGE_SIZES)[number];

export function isDatabasePageSize(value: unknown): value is DatabasePageSize {
  return typeof value === 'number' && (DATABASE_PAGE_SIZES as readonly number[]).includes(value);
}

export type DatabaseColumnClassification = 'public' | 'internal' | 'pii' | 'blocked';

export type DatabaseFilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_null'
  | 'is_not_null';

export type DatabaseCell =
  | {
      state: 'value';
      value: null | boolean | number | string | unknown[] | Record<string, unknown>;
    }
  | { state: 'masked'; display: string }
  | { state: 'blocked' }
  | { state: 'truncated'; display: string; originalBytes: number };

export type DatabaseExplorerColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  hasDefault: boolean;
  identity: 'always' | 'by_default' | null;
  generated: boolean;
  classification: DatabaseColumnClassification;
  selectable: boolean;
  filterOperators: DatabaseFilterOperator[];
};

export type DatabaseRelationEdge = {
  constraint: string;
  from: { schema: string; relation: string; columns: string[] };
  to: { schema: string; relation: string; columns: string[] };
};

export type DatabaseTargetStatus = 'available' | 'unavailable' | 'disabled';

export type DatabaseTargetSummary = {
  id: DatabaseTargetId;
  label: string;
  description?: string;
  status: DatabaseTargetStatus;
  readOnly: boolean;
  unavailableReason?: string;
};

export type DatabaseExplorerRelation = {
  name: string;
  kind: 'table' | 'partitioned_table' | 'view' | 'materialized_view' | 'foreign_table';
  rowLevelSecurity: { enabled: boolean; forced: boolean };
  columns: DatabaseExplorerColumn[];
  constraints: DatabaseConstraint[];
  indexes: DatabaseIndex[];
  triggers: DatabaseTrigger[];
  policies: DatabasePolicy[];
  estimatedRows: number | null;
  dataAvailable: boolean;
  primaryKey: string[] | null;
  paginationKey: string[] | null;
};

export type DatabaseExplorerSchema = {
  name: string;
  relations: DatabaseExplorerRelation[];
};

export type DatabaseExplorerSchemaSnapshot = {
  targetId: DatabaseTargetId;
  targetLabel: string;
  checksum: string;
  policyVersion: string;
  schemas: DatabaseExplorerSchema[];
  edges: DatabaseRelationEdge[];
};

export type DatabaseRowsRequest = {
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  pageSize: DatabasePageSize;
  cursor?: string;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters: Array<{ column: string; operator: DatabaseFilterOperator; value?: string }>;
  piiMode: 'masked' | 'revealed';
};

/** Opaque authenticated row identity returned by the worker and passed back unchanged. */
export type DatabaseExplorerRowRef = string;

export type DatabaseRowsResponse = {
  targetId: DatabaseTargetId;
  schemaChecksum: string;
  policyVersion: string;
  schema: string;
  relation: string;
  columns: DatabaseExplorerColumn[];
  rows: Array<{ rowRef: DatabaseExplorerRowRef | null; cells: Record<string, DatabaseCell> }>;
  nextCursor: string | null;
  truncated: boolean;
  encodedBytes: number;
  consistency: 'stable' | 'best_effort';
  piiMode: 'masked' | 'revealed';
};

export type DatabaseRelatedRowsRequest = {
  targetId: DatabaseTargetId;
  schema: string;
  /** Relation that owns the selected row represented by rowRef. */
  relation: string;
  constraint: string;
  rowRef: DatabaseExplorerRowRef;
  pageSize: DatabasePageSize;
  cursor?: string;
  piiMode: 'masked' | 'revealed';
};
