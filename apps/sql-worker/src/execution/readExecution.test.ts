import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { executeReadOnly } from './readExecution.js';
describe('executeReadOnly', () => {
  it('uses a bounded read-only cursor and transaction', async () => {
    const calls: string[] = [];
    const result = await executeReadOnly({
      sql: 'SELECT id FROM students',
      maxRows: 2,
      database: {
        query: async <T>(sql: string) => {
          calls.push(sql);
          return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] as T[] };
        }
      }
    });
    expect(result).toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      encodedBytes: Buffer.byteLength(JSON.stringify([{ id: 1 }, { id: 2 }]), 'utf8'),
      truncated: true
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        'BEGIN READ ONLY',
        "SET LOCAL statement_timeout = '30s'",
        'FETCH FORWARD 3 FROM ops_read_cursor',
        'ROLLBACK'
      ])
    );
    expect(calls).not.toContain('COMMIT');
  });
});
