import { describe, expect, it } from 'vitest';

import { canonicalizeAuditPayload, createAuditEntryHash } from './hashChain.js';

describe('audit hash chain', () => {
  it('canonicalizes nested audit metadata independent of object insertion order', () => {
    expect(
      canonicalizeAuditPayload({
        subject: { id: 'SQL_123', kind: 'sql_execution' },
        action: 'sql.previewed',
        metadata: { rowCount: 2, truncated: false }
      })
    ).toBe(
      '{"action":"sql.previewed","metadata":{"rowCount":2,"truncated":false},"subject":{"id":"SQL_123","kind":"sql_execution"}}'
    );
  });

  it('binds each entry to the previous hash and canonical payload', () => {
    const payload = { action: 'sql.previewed', subjectId: 'SQL_123' };
    const first = createAuditEntryHash({ previousHash: null, payload });
    const second = createAuditEntryHash({ previousHash: first, payload });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(
      createAuditEntryHash({ previousHash: first, payload: { ...payload, subjectId: 'SQL_124' } })
    ).not.toBe(second);
  });
});
