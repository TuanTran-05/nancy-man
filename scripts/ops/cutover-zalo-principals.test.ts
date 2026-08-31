import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { cutoverZaloPrincipals } from './cutover-zalo-principals.mjs';

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function makeDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'ops-zalo-cutover-'));
  directories.push(directory);
  const path = join(directory, 'ops.sqlite');
  const database = new Database(path);
  database.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE);
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    CREATE TABLE zalo_link_codes (
      code_hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL, consumed_at TEXT
    );
    CREATE TABLE zalo_links (
      principal_id TEXT PRIMARY KEY, chat_id_hash TEXT NOT NULL UNIQUE,
      chat_id_ciphertext TEXT NOT NULL, linked_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL, disabled_at TEXT
    );
    CREATE TABLE zalo_webhook_events (
      event_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  database.prepare('INSERT INTO schema_version (version) VALUES (4)').run();
  database
    .prepare('INSERT INTO accounts (id, username) VALUES (?, ?), (?, ?)')
    .run('legacy-owner', 'tuan.dev', 'legacy-admin', 'ops-admin');
  database
    .prepare(
      `INSERT INTO zalo_link_codes (code_hash, principal_id, expires_at, created_at)
       VALUES ('code', 'legacy-owner', '2026-09-01T00:00:00Z', '2026-08-31T00:00:00Z')`
    )
    .run();
  database
    .prepare(
      `INSERT INTO zalo_links
       (principal_id, chat_id_hash, chat_id_ciphertext, linked_at, last_seen_at)
       VALUES ('legacy-admin', 'chat', 'ciphertext', '2026-08-31T00:00:00Z', '2026-08-31T00:00:00Z')`
    )
    .run();
  database
    .prepare(
      `INSERT INTO zalo_webhook_events (event_id, principal_id, created_at)
       VALUES ('event', 'legacy-owner', '2026-08-31T00:00:00Z')`
    )
    .run();
  database.close();
  return path;
}

describe('Zalo principal cutover', () => {
  it('requires both explicit enrolled usernames and rewrites every Zalo principal reference atomically', () => {
    const databasePath = makeDatabase();

    expect(
      cutoverZaloPrincipals({
        databasePath,
        mappings: [
          { username: 'tuan.dev', principalId: '11111111-1111-4111-8111-111111111111' },
          { username: 'ops-admin', principalId: '22222222-2222-4222-8222-222222222222' }
        ]
      })
    ).toEqual({ linkCodes: 1, links: 1, webhookEvents: 1 });

    const database = new Database(databasePath, { readonly: true });
    expect(database.prepare('SELECT principal_id FROM zalo_link_codes').pluck().all()).toEqual([
      '11111111-1111-4111-8111-111111111111'
    ]);
    expect(database.prepare('SELECT principal_id FROM zalo_links').pluck().all()).toEqual([
      '22222222-2222-4222-8222-222222222222'
    ]);
    expect(database.prepare('SELECT principal_id FROM zalo_webhook_events').pluck().all()).toEqual([
      '11111111-1111-4111-8111-111111111111'
    ]);
    database.close();
  });

  it('fails closed without exactly the two explicit username mappings', () => {
    const databasePath = makeDatabase();

    expect(() =>
      cutoverZaloPrincipals({
        databasePath,
        mappings: [{ username: 'tuan.dev', principalId: '11111111-1111-4111-8111-111111111111' }]
      })
    ).toThrow('OPS_ZALO_CUTOVER_MAPPING_INVALID');
  });
});
