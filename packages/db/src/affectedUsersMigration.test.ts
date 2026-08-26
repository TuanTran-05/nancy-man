import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0005_error_issue_affected_users.sql', import.meta.url),
  'utf8'
);

describe('error affected-user migration', () => {
  it('counts a user at most once per issue without copying their profile', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS error_issue_affected_users');
    expect(migration).toContain('PRIMARY KEY (issue_id, user_reference)');
    expect(migration).toContain('first_seen_at timestamptz NOT NULL');
  });
});
