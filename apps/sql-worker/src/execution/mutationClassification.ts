import { parse } from 'pgsql-ast-parser';

type MutationKind = 'insert' | 'update' | 'delete';

type Result =
  | { allowed: true; kind: MutationKind; requiresTypedConfirmation: boolean }
  | { allowed: false; code: 'SQL_DML_REQUIRED' };

function isMutationKind(value: unknown): value is MutationKind {
  return value === 'insert' || value === 'update' || value === 'delete';
}

export function classifyMutationSql(sql: string): Result {
  try {
    const statements = parse(sql);
    if (statements.length !== 1) return { allowed: false, code: 'SQL_DML_REQUIRED' };
    const statement = statements[0] as { type?: unknown; where?: unknown } | undefined;
    if (!isMutationKind(statement?.type)) return { allowed: false, code: 'SQL_DML_REQUIRED' };
    return {
      allowed: true,
      kind: statement.type,
      requiresTypedConfirmation:
        (statement.type === 'update' || statement.type === 'delete') && !statement.where
    };
  } catch {
    return { allowed: false, code: 'SQL_DML_REQUIRED' };
  }
}
