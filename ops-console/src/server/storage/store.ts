import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { schemaSql, SCHEMA_VERSION } from './schema.js';
import type {
  AlertDelivery,
  DashboardOverview,
  Incident,
  IncidentState,
  MonitorLevel,
  MonitorName,
  MonitorSample,
} from '../../shared/models.js';

type SqliteDatabase = InstanceType<typeof Database>;

export interface AccountRecord {
  id: string;
  username: string;
  passwordHash: string;
  totpSecretEnc: string;
  createdAt: string;
  disabledAt: string | null;
}

export interface SessionRecord {
  tokenHash: string;
  accountId: string;
  csrfTokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  username: string;
}

export interface OpsStore {
  recordSample(sample: MonitorSample): void;
  upsertIncident(
    input: Omit<Incident, 'id' | 'openedAt' | 'lastSeenAt' | 'occurrenceCount'> & { now: string },
  ): Incident;
  getIncident(id: string): Incident | undefined;
  acknowledgeIncident(id: string, input: { accountId: string; note: string; now: string }): Incident;
  enqueueDelivery(input: Omit<AlertDelivery, 'id' | 'attemptCount' | 'state'>): AlertDelivery;
  claimDueDeliveries(now: string, limit: number): AlertDelivery[];
  completeDelivery(id: string): void;
  failDelivery(id: string, input: { state: 'failed' | 'delivery_ambiguous'; errorCode: string; nextAttemptAt: string }): void;
  recordAuditEvent(input: { actorId: string | null; action: string; target: string; details: Record<string, string>; occurredAt: string }): void;
  listAuditEvents(): Array<{ actorId: string | null; action: string; target: string; occurredAt: string }>;
  readDashboardOverview(now?: string): DashboardOverview;
  getCursor(source: string): { inode: number; offset: number } | undefined;
  setCursor(source: string, cursor: { inode: number; offset: number }): void;
  pruneRetention(now?: string): void;
  createAccount(input: { id: string; username: string; passwordHash: string; totpSecretEnc: string; createdAt: string }): void;
  findAccountByUsername(username: string): AccountRecord | undefined;
  findAccountById(id: string): AccountRecord | undefined;
  createSession(input: Omit<SessionRecord, 'username'>): void;
  findSession(tokenHash: string): SessionRecord | undefined;
  touchSession(tokenHash: string, lastSeenAt: string, expiresAt: string): void;
  deleteSession(tokenHash: string): void;
  countRecentFailedLogins(username: string, since: string): number;
  recordLoginAttempt(input: { username: string; attemptedAt: string; success: boolean }): void;
  getDatabaseForBackup(): SqliteDatabase;
}

const cap = (value: string | null, max: number): string | null => (value === null ? null : value.slice(0, max));
const jsonObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const sampleFromRow = (row: Record<string, unknown>): MonitorSample => ({
  monitor: row.monitor as MonitorName,
  level: row.level as MonitorLevel,
  observedAt: row.observed_at as string,
  latencyMs: (row.latency_ms as number | null) ?? null,
  details: jsonObject(JSON.parse(row.details_json as string)),
  errorCode: (row.error_code as string | null) ?? null,
});

const incidentFromRow = (row: Record<string, unknown>): Incident => ({
  id: row.id as string,
  dedupeKey: row.dedupe_key as string,
  monitor: row.monitor as MonitorName,
  level: row.level as Exclude<MonitorLevel, 'unknown' | 'healthy'>,
  state: row.state as IncidentState,
  occurrenceCount: row.occurrence_count as number,
  openedAt: row.opened_at as string,
  lastSeenAt: row.last_seen_at as string,
  recoveredAt: (row.recovered_at as string | null) ?? null,
  acknowledgedAt: (row.acknowledged_at as string | null) ?? null,
  acknowledgedBy: (row.acknowledged_by as string | null) ?? null,
  note: (row.note as string | null) ?? null,
  safeSummary: row.safe_summary as string,
});

const deliveryFromRow = (row: Record<string, unknown>): AlertDelivery => ({
  id: row.id as string,
  incidentId: row.incident_id as string,
  recipientId: row.recipient_id as string,
  kind: row.kind as AlertDelivery['kind'],
  state: row.state as AlertDelivery['state'],
  attemptCount: row.attempt_count as number,
  nextAttemptAt: row.next_attempt_at as string,
  lastErrorCode: (row.last_error_code as string | null) ?? null,
});

export function createOpsStore(path: string, now: () => Date = () => new Date()): OpsStore {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  db.exec('BEGIN');
  try {
    db.exec(schemaSql);
    const version = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    if (!version) db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    else if (version.version !== SCHEMA_VERSION) throw new Error(`Unsupported Ops schema version ${version.version}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  const store: OpsStore = {
    recordSample(sample) {
      db.prepare(
        `INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code)
         VALUES (@monitor, @level, @observedAt, @latencyMs, @detailsJson, @errorCode)`,
      ).run({
        monitor: sample.monitor,
        level: sample.level,
        observedAt: sample.observedAt,
        latencyMs: sample.latencyMs,
        detailsJson: JSON.stringify(jsonObject(sample.details)),
        errorCode: cap(sample.errorCode, 120),
      });
    },

    upsertIncident(input) {
      const active = db
        .prepare('SELECT * FROM incidents WHERE dedupe_key = ? AND state != \'recovered\' ORDER BY opened_at DESC LIMIT 1')
        .get(input.dedupeKey) as Record<string, unknown> | undefined;
      const summary = cap(input.safeSummary, 500) ?? '';
      if (active) {
        const nextState = input.state;
        db.prepare(
          `UPDATE incidents SET level = ?, state = ?, occurrence_count = occurrence_count + 1,
            last_seen_at = ?, recovered_at = ?, safe_summary = ? WHERE id = ?`,
        ).run(
          input.level,
          nextState,
          input.now,
          nextState === 'recovered' ? input.recoveredAt ?? input.now : null,
          summary,
          active.id,
        );
        return incidentFromRow(db.prepare('SELECT * FROM incidents WHERE id = ?').get(active.id) as Record<string, unknown>);
      }

      const id = randomUUID();
      db.prepare(
        `INSERT INTO incidents
          (id, dedupe_key, monitor, level, state, occurrence_count, opened_at, last_seen_at,
           recovered_at, acknowledged_at, acknowledged_by, note, safe_summary)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.dedupeKey,
        input.monitor,
        input.level,
        input.state,
        input.now,
        input.now,
        input.recoveredAt,
        input.acknowledgedAt,
        input.acknowledgedBy,
        cap(input.note, 500),
        summary,
      );
      return incidentFromRow(db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown>);
    },

    getIncident(id) {
      const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? incidentFromRow(row) : undefined;
    },

    acknowledgeIncident(id, input) {
      const incident = store.getIncident(id);
      if (!incident) throw new Error('Incident not found');
      if (incident.state === 'recovered') throw new Error('Recovered incident cannot be acknowledged');
      db.prepare(
        `UPDATE incidents SET state = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, note = ? WHERE id = ?`,
      ).run(input.now, input.accountId, cap(input.note, 500), id);
      store.recordAuditEvent({
        actorId: input.accountId,
        action: 'incident_acknowledged',
        target: id,
        details: { noteLength: String(input.note.length) },
        occurredAt: input.now,
      });
      return store.getIncident(id)!;
    },

    enqueueDelivery(input) {
      const id = randomUUID();
      const createdAt = now().toISOString();
      db.prepare(
        `INSERT INTO alert_deliveries
          (id, incident_id, recipient_id, kind, state, attempt_count, next_attempt_at, last_error_code, created_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, NULL, ?)`,
      ).run(id, input.incidentId, input.recipientId, input.kind, input.nextAttemptAt, createdAt);
      return deliveryFromRow(db.prepare('SELECT * FROM alert_deliveries WHERE id = ?').get(id) as Record<string, unknown>);
    },

    claimDueDeliveries(nowIso, limit) {
      const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
      const transaction = db.transaction(() => {
        const rows = db
          .prepare(
            `SELECT * FROM alert_deliveries
             WHERE next_attempt_at <= ? AND ((state = 'queued') OR (state IN ('failed', 'delivery_ambiguous') AND attempt_count < 5))
             ORDER BY next_attempt_at ASC LIMIT ?`,
          )
          .all(nowIso, boundedLimit) as Array<Record<string, unknown>>;
        const claimed: AlertDelivery[] = [];
        for (const row of rows) {
          db.prepare("UPDATE alert_deliveries SET state = 'sending', attempt_count = attempt_count + 1 WHERE id = ?").run(row.id);
          claimed.push(deliveryFromRow(db.prepare('SELECT * FROM alert_deliveries WHERE id = ?').get(row.id) as Record<string, unknown>));
        }
        return claimed;
      });
      return transaction();
    },

    completeDelivery(id) {
      db.prepare("UPDATE alert_deliveries SET state = 'sent', last_error_code = NULL WHERE id = ?").run(id);
    },

    failDelivery(id, input) {
      db.prepare('UPDATE alert_deliveries SET state = ?, last_error_code = ?, next_attempt_at = ? WHERE id = ?').run(
        input.state,
        cap(input.errorCode, 120),
        input.nextAttemptAt,
        id,
      );
    },

    recordAuditEvent(input) {
      db.prepare(
        'INSERT INTO audit_events (actor_id, action, target, details_json, occurred_at) VALUES (?, ?, ?, ?, ?)',
      ).run(input.actorId, input.action, input.target.slice(0, 200), JSON.stringify(input.details), input.occurredAt);
    },

    listAuditEvents() {
      return (db
        .prepare('SELECT actor_id as actorId, action, target, occurred_at as occurredAt FROM audit_events ORDER BY id ASC')
        .all() as Array<{ actorId: string | null; action: string; target: string; occurredAt: string }>);
    },

    readDashboardOverview() {
      const rows = db
        .prepare(
          `SELECT s.* FROM monitor_samples s
           INNER JOIN (SELECT monitor, MAX(observed_at) AS latest FROM monitor_samples GROUP BY monitor) latest
           ON latest.monitor = s.monitor AND latest.latest = s.observed_at`,
        )
        .all() as Array<Record<string, unknown>>;
      const latestByMonitor: DashboardOverview['latestByMonitor'] = {};
      for (const row of rows) latestByMonitor[row.monitor as MonitorName] = sampleFromRow(row);
      const collectedAt = rows.length === 0 ? null : rows.reduce((latest, row) => (row.observed_at as string) > latest ? row.observed_at as string : latest, '');
      const incidents = db
        .prepare("SELECT * FROM incidents WHERE state IN ('open', 'acknowledged') ORDER BY last_seen_at DESC")
        .all() as Array<Record<string, unknown>>;
      const deliveries = db
        .prepare('SELECT * FROM alert_deliveries ORDER BY created_at DESC LIMIT 50')
        .all() as Array<Record<string, unknown>>;
      return {
        collectedAt,
        latestByMonitor,
        openIncidents: incidents.map(incidentFromRow),
        recentDeliveries: deliveries.map(deliveryFromRow),
      };
    },

    getCursor(source) {
      const row = db.prepare('SELECT inode, offset FROM collector_cursors WHERE source = ?').get(source) as { inode: number; offset: number } | undefined;
      return row;
    },

    setCursor(source, cursor) {
      db.prepare(
        `INSERT INTO collector_cursors (source, inode, offset) VALUES (?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET inode = excluded.inode, offset = excluded.offset`,
      ).run(source, Math.max(0, Math.floor(cursor.inode)), Math.max(0, Math.floor(cursor.offset)));
    },

    pruneRetention(nowDate = now().toISOString()) {
      const nowMs = Date.parse(nowDate);
      if (!Number.isFinite(nowMs)) throw new Error('Invalid retention timestamp');
      const rawCutoff = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
      const rollupCutoff = new Date(nowMs - 365 * 24 * 60 * 60 * 1000).toISOString();
      const eventCutoff = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
      const transaction = db.transaction(() => {
        db.prepare(
          `INSERT INTO daily_rollups (day, monitor, sample_count, last_observed_at, last_level)
           SELECT substr(observed_at, 1, 10), monitor, COUNT(*), MAX(observed_at),
             CASE MAX(CASE level WHEN 'critical' THEN 4 WHEN 'warning' THEN 3 WHEN 'healthy' THEN 2 ELSE 1 END)
               WHEN 4 THEN 'critical' WHEN 3 THEN 'warning' WHEN 2 THEN 'healthy' ELSE 'unknown' END
           FROM monitor_samples WHERE observed_at < ? AND observed_at >= ? GROUP BY substr(observed_at, 1, 10), monitor
           ON CONFLICT(day, monitor) DO UPDATE SET sample_count = daily_rollups.sample_count + excluded.sample_count,
             last_observed_at = MAX(daily_rollups.last_observed_at, excluded.last_observed_at), last_level = excluded.last_level`,
        ).run(rawCutoff, rollupCutoff);
        db.prepare('DELETE FROM monitor_samples WHERE observed_at < ?').run(rawCutoff);
        db.prepare("DELETE FROM incidents WHERE state = 'recovered' AND last_seen_at < ?").run(eventCutoff);
        db.prepare("DELETE FROM alert_deliveries WHERE state IN ('sent', 'failed', 'delivery_ambiguous') AND next_attempt_at < ?").run(eventCutoff);
        db.prepare('DELETE FROM audit_events WHERE occurred_at < ?').run(eventCutoff);
        db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').run(eventCutoff);
        db.prepare('DELETE FROM daily_rollups WHERE day < substr(?, 1, 10)').run(rollupCutoff);
      });
      transaction();
    },

    createAccount(input) {
      db.prepare(
        'INSERT INTO accounts (id, username, password_hash, totp_secret_enc, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, NULL)',
      ).run(input.id, input.username, input.passwordHash, input.totpSecretEnc, input.createdAt);
    },

    findAccountByUsername(username) {
      const row = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as Record<string, unknown> | undefined;
      return row ? {
        id: row.id as string,
        username: row.username as string,
        passwordHash: row.password_hash as string,
        totpSecretEnc: row.totp_secret_enc as string,
        createdAt: row.created_at as string,
        disabledAt: (row.disabled_at as string | null) ?? null,
      } : undefined;
    },

    findAccountById(id) {
      return store.findAccountByUsername(
        (db.prepare('SELECT username FROM accounts WHERE id = ?').get(id) as { username: string } | undefined)?.username ?? '',
      );
    },

    createSession(input) {
      db.prepare(
        `INSERT INTO sessions (token_hash, account_id, csrf_token_hash, created_at, last_seen_at, expires_at, absolute_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.tokenHash, input.accountId, input.csrfTokenHash, input.createdAt, input.lastSeenAt, input.expiresAt, input.absoluteExpiresAt);
    },

    findSession(tokenHash) {
      const row = db
        .prepare(
          `SELECT s.*, a.username FROM sessions s INNER JOIN accounts a ON a.id = s.account_id
           WHERE s.token_hash = ?`,
        )
        .get(tokenHash) as Record<string, unknown> | undefined;
      return row ? {
        tokenHash: row.token_hash as string,
        accountId: row.account_id as string,
        csrfTokenHash: row.csrf_token_hash as string,
        createdAt: row.created_at as string,
        lastSeenAt: row.last_seen_at as string,
        expiresAt: row.expires_at as string,
        absoluteExpiresAt: row.absolute_expires_at as string,
        username: row.username as string,
      } : undefined;
    },

    touchSession(tokenHash, lastSeenAt, expiresAt) {
      db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(lastSeenAt, expiresAt, tokenHash);
    },

    deleteSession(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },

    countRecentFailedLogins(username, since) {
      return (db.prepare('SELECT COUNT(*) as count FROM login_attempts WHERE username = ? AND attempted_at >= ? AND success = 0').get(username, since) as { count: number }).count;
    },

    recordLoginAttempt(input) {
      db.prepare('INSERT INTO login_attempts (username, attempted_at, success) VALUES (?, ?, ?)').run(input.username, input.attemptedAt, input.success ? 1 : 0);
    },

    getDatabaseForBackup() {
      return db;
    },
  };
  return store;
}
