import { describe, expect, it } from 'vitest';

import { databaseRowsResultSchema } from './databaseExplorerSchemas.js';

function rowsResult(value: unknown) {
  return {
    targetId: 'ops',
    schemaChecksum: 'a'.repeat(64),
    policyVersion: 'test-policy',
    schema: 'public',
    relation: 'students',
    columns: [],
    rows: [{ rowRef: null, cells: { profile: { state: 'value', value } } }],
    nextCursor: null,
    truncated: false,
    encodedBytes: 0,
    consistency: 'stable',
    piiMode: 'masked'
  };
}

describe('database explorer result schemas', () => {
  it('accepts recursively nested JSON values in row cells', () => {
    expect(
      databaseRowsResultSchema.safeParse(
        rowsResult({
          name: 'Ada',
          active: true,
          score: 9.5,
          tags: ['learner', null],
          details: { enrolled: true, extra: [{ term: 3 }] }
        })
      ).success
    ).toBe(true);
  });

  it.each([
    ['undefined object value', { nested: undefined }],
    ['function object value', { nested: () => 'no' }],
    ['Date object', new Date('2026-01-01T00:00:00.000Z')],
    ['Buffer object', Buffer.from('not json')],
    ['nested non-finite number', { nested: [Number.NaN] }]
  ])('rejects a %s in row cell values', (_label, value) => {
    expect(databaseRowsResultSchema.safeParse(rowsResult(value)).success).toBe(false);
  });
});
