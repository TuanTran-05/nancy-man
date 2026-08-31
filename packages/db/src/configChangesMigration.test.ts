import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  opsConfigApplicationBlocks,
  opsConfigChangeItems,
  opsConfigChanges,
  opsConfigRuns
} from './schema/auth.js';

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/0017_ops_config_changes.sql', import.meta.url)),
  'utf8'
);

describe('value-free config change migration', () => {
  it('declares all state-machine tables and canonical foreign keys', () => {
    for (const table of [
      'ops_config_changes',
      'ops_config_change_items',
      'ops_config_runs',
      'ops_config_application_blocks'
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE ${table}\\b`));
    }
    expect(migration).toContain('REFERENCES ops_users(id) ON DELETE RESTRICT');
    expect(migration).toContain('REFERENCES ops_sessions(id) ON DELETE RESTRICT');
    expect(migration).toContain('REFERENCES ops_config_changes(id) ON DELETE RESTRICT');
    expect(migration).toContain('REFERENCES ops_config_runs(id) ON DELETE RESTRICT');
  });

  it('enforces enum, reason, terminal, idempotency, and one-active-apply invariants', () => {
    expect(migration).toMatch(
      /state text NOT NULL CHECK \(state IN \([\s\S]*ROLLBACK_FAILED[\s\S]*\)\)/u
    );
    expect(migration).toContain("operation text NOT NULL CHECK (operation IN ('set', 'delete'))");
    expect(migration).toContain(
      'reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000)'
    );
    expect(migration).toContain('UNIQUE (change_id, transition_id)');
    expect(migration).toContain('UNIQUE (change_id, event_id)');
    expect(migration).toContain('UNIQUE (change_id, sequence_number)');
    expect(migration).toContain('WHERE state IN (');
  });

  it('has no value-bearing columns and exposes the same safe tables through Drizzle', () => {
    const tables = [
      opsConfigChanges,
      opsConfigChangeItems,
      opsConfigRuns,
      opsConfigApplicationBlocks
    ];
    expect(tables.map((table) => getTableName(table))).toEqual([
      'ops_config_changes',
      'ops_config_change_items',
      'ops_config_runs',
      'ops_config_application_blocks'
    ]);
    const columns = tables.flatMap((table) => Object.keys(table));
    expect(columns).not.toEqual(
      expect.arrayContaining(['value', 'newValue', 'oldValue', 'plaintext', 'secret'])
    );
    expect(migration).not.toMatch(
      /\b(?:value|new_value|old_value|plaintext|secret|password|totp)\b/iu
    );
  });
});
