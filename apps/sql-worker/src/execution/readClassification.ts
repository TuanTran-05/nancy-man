type Result =
  | { allowed: true; kind: 'select' | 'show' | 'explain' }
  | { allowed: false; code: 'SQL_READ_ONLY_REQUIRED' };

function normalized(sql: string): string | null {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (!withoutComments || (withoutComments.includes(';') && !/;\s*$/.test(withoutComments)))
    return null;
  const statement = withoutComments.replace(/;\s*$/, '').trim();
  return statement && !statement.includes(';')
    ? statement.replace(/\s+/g, ' ').toUpperCase()
    : null;
}

export function classifyReadOnlySql(sql: string): Result {
  const statement = normalized(sql);
  if (!statement) return { allowed: false, code: 'SQL_READ_ONLY_REQUIRED' };
  if (statement.startsWith('SELECT ')) return { allowed: true, kind: 'select' };
  if (statement.startsWith('SHOW ')) return { allowed: true, kind: 'show' };
  if (/^EXPLAIN(?: \([^)]*\))? SELECT /.test(statement)) return { allowed: true, kind: 'explain' };
  return { allowed: false, code: 'SQL_READ_ONLY_REQUIRED' };
}
