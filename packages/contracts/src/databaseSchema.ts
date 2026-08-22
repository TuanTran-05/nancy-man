export type DatabaseSchemaSnapshot = {
  checksum: string;
  schemas: DatabaseSchema[];
};

export type DatabaseSchema = {
  name: string;
  relations: DatabaseRelation[];
};

export type DatabaseRelation = {
  name: string;
  kind: 'table' | 'partitioned_table' | 'view' | 'materialized_view' | 'foreign_table';
  rowLevelSecurity: { enabled: boolean; forced: boolean };
  columns: DatabaseColumn[];
  constraints: DatabaseConstraint[];
  indexes: DatabaseIndex[];
  triggers: DatabaseTrigger[];
  policies: DatabasePolicy[];
};

export type DatabaseColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  hasDefault: boolean;
  identity: 'always' | 'by_default' | null;
  generated: boolean;
};

export type DatabaseConstraint = {
  name: string;
  kind: 'primary_key' | 'unique' | 'foreign_key' | 'check';
  columns: string[];
  referencedRelation: { schema: string; name: string; columns: string[] } | null;
  deferrable: boolean;
  initiallyDeferred: boolean;
};

export type DatabaseIndex = {
  name: string;
  method: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  valid: boolean;
  hasExpressions: boolean;
  partial: boolean;
};

export type DatabaseTrigger = {
  name: string;
  timing: 'before' | 'after' | 'instead_of';
  events: Array<'insert' | 'update' | 'delete' | 'truncate'>;
  enabled: 'enabled' | 'disabled' | 'replica' | 'always';
};

export type DatabasePolicy = {
  name: string;
  command: 'all' | 'select' | 'insert' | 'update' | 'delete';
  permissive: boolean;
  roles: string[];
};
