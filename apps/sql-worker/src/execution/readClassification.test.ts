import { describe, expect, it } from 'vitest';
import { classifyReadOnlySql } from './readClassification.js';
describe('classifyReadOnlySql', () => {
  it('allows only a single read statement and rejects write/multi-statement input', () => {
    expect(classifyReadOnlySql('SELECT id FROM students')).toEqual({
      allowed: true,
      kind: 'select'
    });
    expect(classifyReadOnlySql('/* note */ EXPLAIN SELECT 1')).toEqual({
      allowed: true,
      kind: 'explain'
    });
    for (const sql of [
      'DELETE FROM students',
      'SELECT 1; DELETE FROM students',
      'WITH deleted AS (DELETE FROM students RETURNING *) SELECT * FROM deleted'
    ])
      expect(classifyReadOnlySql(sql)).toEqual({ allowed: false, code: 'SQL_READ_ONLY_REQUIRED' });
  });
});
