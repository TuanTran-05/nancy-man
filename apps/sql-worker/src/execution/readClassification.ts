import { parse } from 'pgsql-ast-parser';

type Result =
  | { allowed: true; kind: 'select' | 'show' }
  | { allowed: false; code: 'SQL_READ_ONLY_REQUIRED' };

function isReadSelect(statement: unknown): boolean {
  if (!statement || typeof statement !== 'object') return false;
  const value = statement as {
    type?: string;
    for?: unknown;
    bind?: Array<{ statement?: unknown }>;
    in?: unknown;
  };
  if (value.type === 'select') return !value.for;
  return (
    value.type === 'with' &&
    Array.isArray(value.bind) &&
    value.bind.every((binding) => isReadSelect(binding.statement)) &&
    isReadSelect(value.in)
  );
}

export function classifyReadOnlySql(sql: string): Result {
  try {
    const statements = parse(sql);
    if (statements.length !== 1) return { allowed: false, code: 'SQL_READ_ONLY_REQUIRED' };
    if (isReadSelect(statements[0])) return { allowed: true, kind: 'select' };
    if (statements[0]?.type === 'show') return { allowed: true, kind: 'show' };
    return { allowed: false, code: 'SQL_READ_ONLY_REQUIRED' };
  } catch {
    return { allowed: false, code: 'SQL_READ_ONLY_REQUIRED' };
  }
}
