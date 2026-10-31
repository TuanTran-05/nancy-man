import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpsStore } from './store.js';

const nowIso = '2026-08-23T00:00:00.000Z';
const rawCutoff = '2026-07-24T00:00:00.000Z';
const rollupCutoff = '2025-08-23T00:00:00.000Z';
const eventCutoff = '2026-05-25T00:00:00.000Z';
const recipientKey = Buffer.alloc(32, 13);
const tempDirs: string[] = [];
const openStores: Array<ReturnType<typeof createOpsStore>> = [];

afterEach(() => {
  while (openStores.length) openStores.pop()!.getDatabaseForBackup().close();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function makeStore(): ReturnType<typeof createOpsStore> {
  const directory = mkdtempSync(join(tmpdir(), 'ops-retention-'));
  tempDirs.push(directory);
  const store = createOpsStore(join(directory, 'ops.sqlite'), () => new Date(nowIso), recipientKey);
  openStores.push(store);
  return store;
}

function insertSample(
  db: Database.Database,
  input: { monitor: string; level: string; observedAt: string }
): void {
  db.prepare(
    `INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code)
     VALUES (?, ?, ?, NULL, '{}', NULL)`
  ).run(input.monitor, input.level, input.observedAt);
}

function seedEquivalenceFixture(db: Database.Database): void {
  db.prepare(
    `INSERT INTO daily_rollups (day, monitor, sample_count, last_observed_at, last_level)
     VALUES ('2026-07-01', 'backup', 9, '2026-06-30T23:59:00.000Z', 'critical')`
  ).run();

  const insert = db.prepare(
    `INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code)
     VALUES (?, ?, ?, NULL, '{}', NULL)`
  );
  const dayStart = Date.parse('2026-07-01T00:00:00.000Z');
  for (let index = 0; index < 2_105; index += 1) {
    insert.run(
      'backup',
      index === 2_000 ? 'warning' : 'healthy',
      new Date(dayStart + index * 1_000).toISOString()
    );
  }
  insert.run('postgres', 'critical', '2026-07-02T00:00:00.000Z');
  insert.run('postgres', 'unknown', '2026-07-02T00:00:01.000Z');
  insert.run('cron', 'healthy', rollupCutoff);
  insert.run('cron', 'critical', '2025-08-22T23:59:59.999Z');
  insert.run('backup', 'healthy', rawCutoff);
  insert.run('backup', 'healthy', '2026-08-22T00:00:00.000Z');
}

function applyOriginalSqlRetention(db: Database.Database): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO daily_rollups (day, monitor, sample_count, last_observed_at, last_level)
       SELECT substr(observed_at, 1, 10), monitor, COUNT(*), MAX(observed_at),
         CASE MAX(CASE level WHEN 'critical' THEN 4 WHEN 'warning' THEN 3 WHEN 'healthy' THEN 2 ELSE 1 END)
           WHEN 4 THEN 'critical' WHEN 3 THEN 'warning' WHEN 2 THEN 'healthy' ELSE 'unknown' END
       FROM monitor_samples WHERE observed_at < ? AND observed_at >= ?
       GROUP BY substr(observed_at, 1, 10), monitor
       ON CONFLICT(day, monitor) DO UPDATE SET
         sample_count = daily_rollups.sample_count + excluded.sample_count,
         last_observed_at = MAX(daily_rollups.last_observed_at, excluded.last_observed_at),
         last_level = excluded.last_level`
    ).run(rawCutoff, rollupCutoff);
    db.prepare('DELETE FROM monitor_samples WHERE observed_at < ?').run(rawCutoff);
    db.prepare("DELETE FROM incidents WHERE state = 'recovered' AND last_seen_at < ?").run(
      eventCutoff
    );
    db.prepare(
      "DELETE FROM alert_deliveries WHERE state IN ('sent', 'failed', 'delivery_ambiguous') AND next_attempt_at < ?"
    ).run(eventCutoff);
    db.prepare('DELETE FROM audit_events WHERE occurred_at < ?').run(eventCutoff);
    db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').run(eventCutoff);
    db.prepare('DELETE FROM daily_rollups WHERE day < substr(?, 1, 10)').run(rollupCutoff);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function drainRetention(store: ReturnType<typeof createOpsStore>, now = nowIso): string[] {
  const batches: string[] = [];
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const result = store.pruneRetentionBatch(now);
    if (result.status === 'complete') return batches;
    if (result.status === 'not_due') throw new Error('Retention unexpectedly not due');
    batches.push(`${result.table}:${result.rows}`);
  }
  throw new Error('Retention did not finish within the bounded fixture batches');
}

describe('batched Ops retention', () => {
  it('matches the original SQL rollups across split batches and preserves the 365-day cap', () => {
    const batched = makeStore();
    const original = makeStore();
    const batchedDb = batched.getDatabaseForBackup();
    const originalDb = original.getDatabaseForBackup();
    seedEquivalenceFixture(batchedDb);
    seedEquivalenceFixture(originalDb);

    const batches = drainRetention(batched);
    applyOriginalSqlRetention(originalDb);

    expect(batches.some((batch) => batch === 'monitor_samples:1000')).toBe(true);
    expect(
      batchedDb
        .prepare('SELECT id, monitor, level, observed_at FROM monitor_samples ORDER BY id')
        .all()
    ).toEqual(
      originalDb
        .prepare('SELECT id, monitor, level, observed_at FROM monitor_samples ORDER BY id')
        .all()
    );
    expect(
      batchedDb
        .prepare(
          'SELECT day, monitor, sample_count, last_observed_at, last_level FROM daily_rollups ORDER BY day, monitor'
        )
        .all()
    ).toEqual(
      originalDb
        .prepare(
          'SELECT day, monitor, sample_count, last_observed_at, last_level FROM daily_rollups ORDER BY day, monitor'
        )
        .all()
    );
    expect(
      batchedDb
        .prepare(
          "SELECT last_level FROM daily_rollups WHERE day = '2026-07-01' AND monitor = 'backup'"
        )
        .get()
    ).toEqual({ last_level: 'warning' });
    expect(
      batchedDb
        .prepare('SELECT COUNT(*) AS count FROM monitor_samples WHERE observed_at >= ?')
        .get(rawCutoff)
    ).toEqual({ count: 2 });
    expect(batchedDb.prepare('SELECT COUNT(*) AS count FROM retention_rollup_stage').get()).toEqual(
      { count: 0 }
    );
    expect(batched.pruneRetentionBatch('2026-08-23T01:00:00.000Z')).toEqual({
      status: 'not_due',
      rows: 0
    });
  });

  it('limits every sample transaction to 1,000 rows', () => {
    const store = makeStore();
    const db = store.getDatabaseForBackup();
    const insert = db.prepare(
      `INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code)
       VALUES ('errors', 'healthy', ?, NULL, '{}', NULL)`
    );
    for (let index = 0; index < 2_305; index += 1)
      insert.run(new Date(Date.parse('2026-06-01T00:00:00.000Z') + index).toISOString());

    expect(store.pruneRetentionBatch(nowIso)).toMatchObject({
      status: 'batch',
      table: 'monitor_samples',
      rows: 1_000
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM monitor_samples').get()).toEqual({
      count: 1_305
    });
  });

  it('does not accumulate rollups again when a completed run is repeated the next day', () => {
    const store = makeStore();
    const db = store.getDatabaseForBackup();
    insertSample(db, {
      monitor: 'backup',
      level: 'healthy',
      observedAt: '2026-01-02T00:00:00.000Z'
    });
    drainRetention(store);
    const before = db
      .prepare(
        'SELECT day, monitor, sample_count, last_observed_at, last_level FROM daily_rollups ORDER BY day, monitor'
      )
      .all();

    expect(drainRetention(store, '2026-08-24T01:00:00.000Z')).toEqual([]);
    expect(
      db
        .prepare(
          'SELECT day, monitor, sample_count, last_observed_at, last_level FROM daily_rollups ORDER BY day, monitor'
        )
        .all()
    ).toEqual(before);
  });

  it('deletes audit events older than 90 days and preserves newer events', () => {
    const store = makeStore();
    const db = store.getDatabaseForBackup();
    const insert = db.prepare(
      'INSERT INTO audit_events (actor_id, action, target, details_json, occurred_at) VALUES (?, ?, ?, ?, ?)'
    );
    insert.run(null, 'login_failed', 'ops-a', '{"reason":"old"}', '2026-01-01T00:00:00.000Z');
    insert.run(null, 'login_failed', 'ops-a', '{"reason":"new"}', '2026-07-01T00:00:00.000Z');

    drainRetention(store);

    expect(db.prepare('SELECT occurred_at FROM audit_events').all()).toEqual([
      { occurred_at: '2026-07-01T00:00:00.000Z' }
    ]);
  });

  it('limits each audit-event cleanup transaction to 1,000 oldest rows', () => {
    const store = makeStore();
    const db = store.getDatabaseForBackup();
    const insert = db.prepare(
      'INSERT INTO audit_events (actor_id, action, target, details_json, occurred_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (let index = 0; index < 2_305; index += 1) {
      insert.run(
        null,
        'login_failed',
        'ops-a',
        '{}',
        new Date(Date.parse('2026-01-01T00:00:00.000Z') + index).toISOString()
      );
    }

    expect(store.pruneRetentionBatch(nowIso)).toMatchObject({
      status: 'batch',
      table: 'audit_events',
      rows: 1_000
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get()).toEqual({
      count: 1_305
    });
    expect(db.prepare('SELECT MIN(occurred_at) AS oldest FROM audit_events').get()).toEqual({
      oldest: new Date(Date.parse('2026-01-01T00:00:00.000Z') + 1_000).toISOString()
    });
  });
});
