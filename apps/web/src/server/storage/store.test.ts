import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { createOpsStore } from './store.js';
import { schemaSql } from './schema.js';
import { encryptSecret } from '../security/crypto.js';

const tempDirs: string[] = [];
const recipientKey = Buffer.alloc(32, 10);
const makeStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-store-'));
  tempDirs.push(dir);
  return createOpsStore(
    join(dir, 'ops.sqlite'),
    () => new Date('2026-08-23T00:00:00.000Z'),
    recipientKey
  );
};

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('Ops SQLite store', () => {
  it('retains only sanitized samples inside the 30-day window', () => {
    const store = makeStore();
    store.recordSample({
      monitor: 'postgres',
      level: 'healthy',
      observedAt: '2026-07-23T00:00:00Z',
      latencyMs: 4,
      details: {},
      errorCode: null
    });
    store.pruneRetention();
    expect(store.readDashboardOverview().latestByMonitor.postgres).toBeUndefined();
  });

  it('acknowledges an incident without modifying its source sample', () => {
    const store = makeStore();
    store.recordSample({
      monitor: 'postgres',
      level: 'critical',
      observedAt: '2026-08-23T00:00:00Z',
      latencyMs: null,
      details: { safe: true },
      errorCode: 'database_unreachable'
    });
    const incident = store.upsertIncident({
      dedupeKey: 'postgres:database_unreachable',
      monitor: 'postgres',
      level: 'critical',
      state: 'open',
      recoveredAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      note: null,
      safeSummary: 'Database unavailable',
      now: '2026-08-23T00:00:00Z'
    });
    store.acknowledgeIncident(incident.id, {
      accountId: 'ops-a',
      note: 'Đã xem',
      now: '2026-08-23T00:01:00Z'
    });
    expect(store.getIncident(incident.id)).toMatchObject({
      state: 'acknowledged',
      acknowledgedBy: 'ops-a'
    });
    expect(store.readDashboardOverview().latestByMonitor.postgres?.errorCode).toBe(
      'database_unreachable'
    );
  });

  it('claims due deliveries exactly once and records bounded retry state', () => {
    const store = makeStore();
    const incident = store.upsertIncident({
      dedupeKey: 'app:down',
      monitor: 'app_liveness',
      level: 'critical',
      state: 'open',
      recoveredAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      note: null,
      safeSummary: 'App unavailable',
      now: '2026-08-23T00:00:00Z'
    });
    const delivery = store.enqueueDelivery({
      incidentId: incident.id,
      recipientCiphertext: encryptSecret('ops-a', recipientKey),
      kind: 'opened',
      nextAttemptAt: '2026-08-23T00:00:00Z',
      lastErrorCode: null
    });
    const claimed = store.claimDueDeliveries('2026-08-23T00:00:01Z', 10);
    expect(claimed).toHaveLength(1);
    expect(store.claimDueDeliveries('2026-08-23T00:00:02Z', 10)).toHaveLength(0);
    store.failDelivery(delivery.id, {
      state: 'failed',
      errorCode: 'timeout',
      nextAttemptAt: '2026-08-23T00:01:00Z'
    });
    expect(store.claimDueDeliveries('2026-08-23T00:01:00Z', 10)[0]).toMatchObject({
      attemptCount: 2,
      state: 'sending'
    });
  });

  it('persists cursors and writes audit events with bounded notes', () => {
    const store = makeStore();
    store.setCursor('/var/log/cron.log', { inode: 4, offset: 10 });
    expect(store.getCursor('/var/log/cron.log')).toEqual({ inode: 4, offset: 10 });
    store.recordAuditEvent({
      actorId: null,
      action: 'login_failed',
      target: 'ops-a',
      details: { reason: 'invalid' },
      occurredAt: '2026-08-23T00:00:00Z'
    });
    expect(store.listAuditEvents()).toContainEqual(
      expect.objectContaining({ action: 'login_failed' })
    );
  });

  it('consumes an Ops Zalo link code once and keeps only encrypted recipient data', () => {
    const store = makeStore();
    const key = Buffer.alloc(32, 9);
    store.createAccount({
      id: 'ops-a',
      username: 'ops-a',
      passwordHash: 'hash',
      totpSecretEnc: 'enc',
      createdAt: '2026-08-23T00:00:00.000Z'
    });
    store.createZaloLinkCode({
      codeHash: 'code-hash',
      accountId: 'ops-a',
      expiresAt: '2026-08-23T00:10:00.000Z',
      createdAt: '2026-08-23T00:00:00.000Z'
    });
    const linked = store.consumeZaloLink({
      codeHash: 'code-hash',
      chatIdHash: 'chat-hash',
      chatIdCiphertext: encryptSecret('chat-123', key),
      eventId: 'message-1',
      now: '2026-08-23T00:01:00.000Z'
    });
    expect(linked).toMatchObject({ outcome: 'linked', accountId: 'ops-a' });
    expect(store.listActiveZaloRecipients()).toEqual([
      {
        recipientHash: 'chat-hash',
        recipientCiphertext: expect.not.stringContaining('chat-123')
      }
    ]);
    expect(
      store.consumeZaloLink({
        codeHash: 'code-hash',
        chatIdHash: 'chat-hash',
        chatIdCiphertext: 'unused',
        eventId: 'message-1',
        now: '2026-08-23T00:02:00.000Z'
      })
    ).toEqual({ outcome: 'already_processed' });
    expect(store.getZaloLinkStatus('ops-a')).toMatchObject({
      linkedAt: '2026-08-23T00:01:00.000Z'
    });
  });

  it('migrates legacy Zalo account foreign keys into canonical principal ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-zalo-principal-migration-'));
    tempDirs.push(dir);
    const databasePath = join(dir, 'ops.sqlite');
    const legacy = new Database(databasePath);
    legacy.exec(
      schemaSql
        .replaceAll('principal_id', 'account_id')
        .replaceAll('idx_zalo_link_codes_principal_expiry', 'idx_zalo_link_codes_account_expiry')
    );
    legacy.prepare('INSERT INTO schema_version (version) VALUES (3)').run();
    legacy
      .prepare(
        `INSERT INTO zalo_link_codes (code_hash, account_id, expires_at, created_at, consumed_at)
         VALUES ('legacy-code', 'legacy-account', '2026-08-23T00:10:00.000Z', '2026-08-23T00:00:00.000Z', NULL)`
      )
      .run();
    legacy.close();

    const store = createOpsStore(databasePath, () => new Date('2026-08-23T00:01:00.000Z'));
    const database = store.getDatabaseForBackup();
    const columns = database.prepare('PRAGMA table_info(zalo_link_codes)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('principal_id');
    expect(columns.map((column) => column.name)).not.toContain('account_id');
    expect((database.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(4);
    expect(
      store.consumeZaloLink({
        codeHash: 'legacy-code',
        chatIdHash: 'chat-hash',
        chatIdCiphertext: encryptSecret('chat', recipientKey),
        eventId: 'event-legacy',
        now: '2026-08-23T00:01:00.000Z'
      })
    ).toMatchObject({ outcome: 'linked', principalId: 'legacy-account' });
    database.close();
  });
});
