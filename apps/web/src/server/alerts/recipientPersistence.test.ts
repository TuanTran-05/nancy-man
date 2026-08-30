import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createOpsApp } from '../http/app.js';
import { createAuthService, provisionAccount } from '../security/auth.js';
import { encryptSecret } from '../security/crypto.js';
import { schemaSql } from '../storage/schema.js';
import { createOpsStore } from '../storage/store.js';
import { createAlertService } from './alertService.js';

const now = new Date('2026-08-23T00:00:00.000Z');
const recipientKey = Buffer.alloc(32, 11);

const fileLeaks = (databasePath: string, sentinel: string): string[] =>
  ['', '-wal', '-shm'].flatMap((suffix) => {
    const path = `${databasePath}${suffix}`;
    return existsSync(path) && readFileSync(path).includes(Buffer.from(sentinel)) ? [path] : [];
  });

const transition = {
  monitor: 'app_liveness' as const,
  sample: {
    monitor: 'app_liveness' as const,
    level: 'critical' as const,
    observedAt: now.toISOString(),
    latencyMs: null,
    details: {},
    errorCode: 'app_down'
  },
  level: 'critical' as const,
  transition: 'opened' as const,
  dedupeKey: 'app_liveness:app_down',
  safeSummary: 'App unavailable',
  occurrenceCount: 1
};

describe('Zalo delivery recipient confidentiality', () => {
  it('keeps a fresh raw recipient out of delivery SQL, SQLite bytes, and authenticated API output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-zalo-fresh-'));
    const databasePath = join(directory, 'ops.sqlite');
    const rawRecipient = 'RAW-ZALO-RECIPIENT-FRESH-483902';
    const store = createOpsStore(databasePath, () => now, recipientKey);
    const sender = vi.fn(async () => ({ messageId: 'sent' }));
    const service = createAlertService({
      store,
      botToken: 'bot-secret',
      recipientCiphertexts: [encryptSecret(rawRecipient, recipientKey)],
      recipientKey,
      timeoutMs: 5000,
      now: () => now,
      sender
    });
    try {
      await service.queueTransitionDelivery(transition);
      const dataKey = Buffer.alloc(32, 7);
      const provisioned = provisionAccount(
        store,
        {
          username: 'ops-zalo-test',
          password: 'correct horse battery staple',
          totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
        },
        dataKey,
        now
      );
      const auth = createAuthService({ store, dataKey, now: () => now });
      const session = auth.createSession(provisioned.account);
      const api = await request(createOpsApp({ store, auth }))
        .get('/api/overview')
        .set('Cookie', `__Host-ops_session=${session.token}`)
        .expect(200);
      const database = store.getDatabaseForBackup();
      database.pragma('wal_checkpoint(TRUNCATE)');

      const columns = database.prepare('PRAGMA table_info(alert_deliveries)').all() as Array<{
        name: string;
      }>;
      const rowText = JSON.stringify(database.prepare('SELECT * FROM alert_deliveries').all());
      const violations = [
        ...(columns.some((column) => column.name === 'recipient_id')
          ? ['recipient_id column']
          : []),
        ...(columns.some((column) => column.name === 'recipient_ciphertext')
          ? []
          : ['missing recipient_ciphertext column']),
        ...(rowText.includes(rawRecipient) ? ['SQL row'] : []),
        ...(JSON.stringify(api.body).includes(rawRecipient) ? ['authenticated API'] : []),
        ...fileLeaks(databasePath, rawRecipient)
      ];
      expect(violations).toEqual([]);

      await service.deliverDueAlerts(new Date(now.getTime() + 1));
      expect(sender).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: rawRecipient }),
        expect.any(String)
      );
    } finally {
      store.getDatabaseForBackup().close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('migrates a v2 plaintext row, removes legacy bytes, and preserves retry delivery behavior', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-zalo-legacy-'));
    const databasePath = join(directory, 'ops.sqlite');
    const rawRecipient = 'RAW-ZALO-RECIPIENT-LEGACY-571306';
    const legacy = new Database(databasePath);
    legacy.exec(
      schemaSql.replace('recipient_ciphertext TEXT NOT NULL', 'recipient_id TEXT NOT NULL')
    );
    legacy.prepare('INSERT INTO schema_version (version) VALUES (2)').run();
    legacy
      .prepare(
        `INSERT INTO alert_deliveries
          (id, incident_id, recipient_id, kind, state, attempt_count, next_attempt_at, last_error_code, created_at)
         VALUES ('legacy-delivery', NULL, ?, 'collector_failed', 'queued', 0, ?, NULL, ?)`
      )
      .run(rawRecipient, now.toISOString(), now.toISOString());
    legacy.close();

    expect(() => createOpsStore(databasePath, () => now)).toThrow(
      'OPS_ZALO_RECIPIENT_KEY is required'
    );
    const store = createOpsStore(databasePath, () => now, recipientKey);
    const sender = vi
      .fn<(config: { recipientId: string }, text: string) => Promise<{ messageId: string }>>()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ messageId: 'sent-after-retry' });
    const service = createAlertService({
      store,
      botToken: 'bot-secret',
      recipientCiphertexts: [],
      recipientKey,
      timeoutMs: 5000,
      now: () => now,
      sender
    });
    try {
      await service.deliverDueAlerts(now);
      await service.deliverDueAlerts(new Date(now.getTime() + 60_001));
      expect(sender).toHaveBeenCalledTimes(2);
      expect(sender.mock.calls.map(([config]) => config.recipientId)).toEqual([
        rawRecipient,
        rawRecipient
      ]);

      const database = store.getDatabaseForBackup();
      const version = database.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      const columns = database.prepare('PRAGMA table_info(alert_deliveries)').all() as Array<{
        name: string;
      }>;
      expect(version.version).toBe(3);
      expect(columns.map((column) => column.name)).not.toContain('recipient_id');
      expect(
        JSON.stringify(database.prepare('SELECT * FROM alert_deliveries').all())
      ).not.toContain(rawRecipient);
      database.pragma('wal_checkpoint(TRUNCATE)');
      database.close();
      expect(fileLeaks(databasePath, rawRecipient)).toEqual([]);
    } finally {
      if (store.getDatabaseForBackup().open) store.getDatabaseForBackup().close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
