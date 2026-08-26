import { classifyReadOnlySql } from './readClassification.js';
import { encodeBoundedRows } from './resultEncoding.js';

type Database = { query: <T>(sql: string) => Promise<{ rows: T[] }> };
export async function executeReadOnly(input: {
  sql: string;
  database: Database;
  maxRows?: number;
  maxBytes?: number;
}): Promise<{ rows: unknown[]; encodedBytes: number; truncated: boolean }> {
  const classification = classifyReadOnlySql(input.sql);
  if (!classification.allowed) throw new Error(classification.code);
  const maxRows = Math.min(Math.max(input.maxRows ?? 500, 1), 500);
  const maxBytes = Math.min(Math.max(input.maxBytes ?? 10 * 1024 * 1024, 2), 10 * 1024 * 1024);
  const statement = input.sql.replace(/;\s*$/, '').trim();
  await input.database.query('BEGIN READ ONLY');
  try {
    await input.database.query("SET LOCAL statement_timeout = '30s'");
    await input.database.query("SET LOCAL lock_timeout = '3s'");
    await input.database.query(`DECLARE ops_read_cursor NO SCROLL CURSOR FOR ${statement}`);
    const { rows } = await input.database.query<unknown>(
      `FETCH FORWARD ${maxRows + 1} FROM ops_read_cursor`
    );
    await input.database.query('CLOSE ops_read_cursor');
    await input.database.query('ROLLBACK');
    const encoded = encodeBoundedRows({ rows: rows.slice(0, maxRows), maxBytes });
    return {
      ...encoded,
      truncated: encoded.truncated || rows.length > maxRows
    };
  } catch (error) {
    await input.database.query('ROLLBACK');
    throw error;
  }
}
