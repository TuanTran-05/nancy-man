import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../migrations/0014_ops_account_administration.sql', import.meta.url),
  'utf8'
);

describe('ops account administration migration', () => {
  it('separates login cooldown from owner lock and records account events', () => {
    expect(sql).toContain('login_blocked_until');
    expect(sql).toContain('administratively_locked_at');
    expect(sql).toContain('administratively_locked_by');
    expect(sql).toContain('CREATE TABLE ops_account_events');
    expect(sql).toMatch(/purpose IN \('bootstrap', 'recovery', 'invite'\)/u);
  });
});
