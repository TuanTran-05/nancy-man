import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { schemaSql, SCHEMA_VERSION } from './schema.js';
import { encryptSecret } from '../security/crypto.js';
import type {
  AlertDelivery,
  DashboardOverview,
  Incident,
  IncidentState,
  MonitorLevel,
  MonitorName,
  MonitorSample,
  InfrastructureHistoryPoint,
  InfrastructureHistoryResolution
} from '../../shared/models.js';

type SqliteDatabase = InstanceType<typeof Database>;

export interface RetentionBatchResult {
  status: 'not_due' | 'batch' | 'complete';
  table?: string;
  rows: number;
}

export interface OpsStoreOptions {
  busyTimeoutMs?: number;
}

const RETENTION_BATCH_SIZE = 1_000;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

function retentionLevelRank(level: string): number {
  if (level === 'critical') return 4;
  if (level === 'warning') return 3;
  if (level === 'healthy') return 2;
  return 1;
}

function retentionLevelFromRank(rank: number): string {
  if (rank === 4) return 'critical';
  if (rank === 3) return 'warning';
  if (rank === 2) return 'healthy';
  return 'unknown';
}

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
  csrfToken: string;
  csrfTokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  username: string;
}

export interface ZaloLinkStatus {
  linkedAt: string;
  lastSeenAt: string;
}

export type ZaloLinkConsumeResult =
  | { outcome: 'linked'; principalId: string; accountId: string; linkedAt: string }
  | { outcome: 'already_processed' }
  | { outcome: 'invalid_code' }
  | { outcome: 'chat_already_linked' };

export interface ZaloRecipientRecord {
  recipientHash: string;
  recipientCiphertext: string;
}

export interface OpsStore {
  recordSample(sample: MonitorSample): void;
  upsertIncident(
    input: Omit<Incident, 'id' | 'openedAt' | 'lastSeenAt' | 'occurrenceCount'> & { now: string }
  ): Incident;
  reconcileIncidents(input: { monitor: MonitorName; activeDedupeKey?: string; now: string }): void;
  getIncident(id: string): Incident | undefined;
  acknowledgeIncident(
    id: string,
    input: { accountId: string; note: string; now: string }
  ): Incident;
  enqueueDelivery(
    input: Omit<AlertDelivery, 'id' | 'attemptCount' | 'state'> & {
      recipientCiphertext: string;
    }
  ): AlertDelivery;
  hasDelivery(input: { incidentId: string; kind: AlertDelivery['kind']; since?: string }): boolean;
  claimDueDeliveries(now: string, limit: number): AlertDeliveryRecord[];
  completeDelivery(id: string): void;
  failDelivery(
    id: string,
    input: { state: 'failed' | 'delivery_ambiguous'; errorCode: string; nextAttemptAt: string }
  ): void;
  recordAuditEvent(input: {
    actorId: string | null;
    action: string;
    target: string;
    details: Record<string, string>;
    occurredAt: string;
  }): void;
  listAuditEvents(): Array<{
    actorId: string | null;
    action: string;
    target: string;
    occurredAt: string;
  }>;
  readDashboardOverview(now?: string): DashboardOverview;
  readInfrastructureHistory(input: {
    from: string;
    to: string;
    resolutionSeconds: InfrastructureHistoryResolution;
    limit: number;
  }): InfrastructureHistoryPoint[];
  getCursor(source: string): { inode: number; offset: number } | undefined;
  setCursor(source: string, cursor: { inode: number; offset: number }): void;
  pruneRetentionBatch(now?: string): RetentionBatchResult;
  createAccount(input: {
    id: string;
    username: string;
    passwordHash: string;
    totpSecretEnc: string;
    createdAt: string;
  }): void;
  findAccountByUsername(username: string): AccountRecord | undefined;
  findAccountById(id: string): AccountRecord | undefined;
  recoverAccountCredentials(input: {
    accountId: string;
    username: string;
    passwordHash: string;
    totpSecretEnc: string;
  }): void;
  createSession(input: Omit<SessionRecord, 'username'>): void;
  findSession(tokenHash: string): SessionRecord | undefined;
  touchSession(tokenHash: string, lastSeenAt: string, expiresAt: string): void;
  deleteSession(tokenHash: string): void;
  countRecentFailedLogins(username: string, since: string): number;
  recordLoginAttempt(input: { username: string; attemptedAt: string; success: boolean }): void;
  createZaloLinkCode(input: {
    codeHash: string;
    principalId?: string;
    accountId?: string;
    expiresAt: string;
    createdAt: string;
  }): void;
  getZaloLinkStatus(principalId: string): ZaloLinkStatus | undefined;
  consumeZaloLink(input: {
    codeHash: string;
    principalId?: string;
    accountId?: string;
    chatIdHash: string;
    chatIdCiphertext: string;
    eventId: string;
    now: string;
  }): ZaloLinkConsumeResult;
  disableZaloLink(principalId: string, disabledAt: string): void;
  listActiveZaloRecipients(): ZaloRecipientRecord[];
  getDatabaseForBackup(): SqliteDatabase;
}

export interface AlertDeliveryRecord extends AlertDelivery {
  recipientCiphertext: string;
}

const cap = (value: string | null, max: number): string | null =>
  value === null ? null : value.slice(0, max);
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
  errorCode: (row.error_code as string | null) ?? null
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
  safeSummary: row.safe_summary as string
});

const deliveryFromRow = (row: Record<string, unknown>): AlertDelivery => ({
  id: row.id as string,
  incidentId: row.incident_id as string,
  kind: row.kind as AlertDelivery['kind'],
  state: row.state as AlertDelivery['state'],
  attemptCount: row.attempt_count as number,
  nextAttemptAt: row.next_attempt_at as string,
  lastErrorCode: (row.last_error_code as string | null) ?? null
});

const deliveryRecordFromRow = (row: Record<string, unknown>): AlertDeliveryRecord => ({
  ...deliveryFromRow(row),
  recipientCiphertext: row.recipient_ciphertext as string
});

function migrateDeliveryRecipients(
  db: SqliteDatabase,
  fromVersion: number,
  recipientKey?: Buffer
): boolean {
  if (fromVersion >= 3) return false;
  const columns = db.prepare('PRAGMA table_info(alert_deliveries)').all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'recipient_id')) {
    if (columns.some((column) => column.name === 'recipient_ciphertext')) return true;
    throw new Error('Unsupported legacy alert delivery schema');
  }
  const legacyRows = db.prepare('SELECT * FROM alert_deliveries').all() as Array<
    Record<string, unknown>
  >;
  if (legacyRows.length > 0 && !recipientKey)
    throw new Error('OPS_ZALO_RECIPIENT_KEY is required to migrate legacy alert deliveries');

  db.exec('ALTER TABLE alert_deliveries RENAME TO alert_deliveries_v2');
  db.exec(`
    CREATE TABLE alert_deliveries (
      id TEXT PRIMARY KEY,
      incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
      recipient_ciphertext TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      next_attempt_at TEXT NOT NULL,
      last_error_code TEXT,
      created_at TEXT NOT NULL
    )
  `);
  const insert = db.prepare(
    `INSERT INTO alert_deliveries
      (id, incident_id, recipient_ciphertext, kind, state, attempt_count, next_attempt_at,
       last_error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of legacyRows)
    insert.run(
      row.id,
      row.incident_id,
      encryptSecret(row.recipient_id as string, recipientKey!),
      row.kind,
      row.state,
      row.attempt_count,
      row.next_attempt_at,
      row.last_error_code,
      row.created_at
    );
  db.exec('DROP TABLE alert_deliveries_v2');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_deliveries_due ON alert_deliveries (state, next_attempt_at)'
  );
  return legacyRows.length > 0;
}

function migrateZaloPrincipals(db: SqliteDatabase, fromVersion: number): boolean {
  if (fromVersion >= 4) return false;
  const columns = db.prepare('PRAGMA table_info(zalo_links)').all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'principal_id')) return false;
  db.exec('DROP INDEX IF EXISTS idx_zalo_link_codes_account_expiry');
  db.exec('ALTER TABLE zalo_link_codes RENAME TO zalo_link_codes_legacy');
  db.exec('ALTER TABLE zalo_links RENAME TO zalo_links_legacy');
  db.exec('ALTER TABLE zalo_webhook_events RENAME TO zalo_webhook_events_legacy');
  db.exec(`
    CREATE TABLE zalo_link_codes (
      code_hash TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE TABLE zalo_links (
      principal_id TEXT PRIMARY KEY,
      chat_id_hash TEXT NOT NULL UNIQUE,
      chat_id_ciphertext TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      disabled_at TEXT
    );
    CREATE TABLE zalo_webhook_events (
      event_id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO zalo_link_codes (code_hash, principal_id, expires_at, created_at, consumed_at)
      SELECT code_hash, account_id, expires_at, created_at, consumed_at FROM zalo_link_codes_legacy;
    INSERT INTO zalo_links (principal_id, chat_id_hash, chat_id_ciphertext, linked_at, last_seen_at, disabled_at)
      SELECT account_id, chat_id_hash, chat_id_ciphertext, linked_at, last_seen_at, disabled_at FROM zalo_links_legacy;
    INSERT INTO zalo_webhook_events (event_id, principal_id, created_at)
      SELECT event_id, account_id, created_at FROM zalo_webhook_events_legacy;
    DROP TABLE zalo_link_codes_legacy;
    DROP TABLE zalo_links_legacy;
    DROP TABLE zalo_webhook_events_legacy;
    CREATE INDEX idx_zalo_link_codes_principal_expiry ON zalo_link_codes (principal_id, expires_at);
    CREATE INDEX idx_zalo_links_active ON zalo_links (disabled_at, linked_at DESC);
  `);
  return true;
}

export function createOpsStore(
  path: string,
  now: () => Date = () => new Date(),
  recipientKey?: Buffer,
  options: OpsStoreOptions = {}
): OpsStore {
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 1 || busyTimeoutMs > 60_000)
    throw new Error('Invalid SQLite busy timeout');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Keep startup/migration tolerant of another service opening the shared database.
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  db.pragma('secure_delete = ON');
  let requiresLegacySanitization = false;
  db.exec('BEGIN');
  try {
    db.exec(schemaSql);
    const version = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
      | { version: number }
      | undefined;
    if (!version) db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    else if (version.version > SCHEMA_VERSION)
      throw new Error(`Unsupported Ops schema version ${version.version}`);
    else if (version.version < SCHEMA_VERSION) {
      const migratedRecipients = migrateDeliveryRecipients(db, version.version, recipientKey);
      const migratedZalo = migrateZaloPrincipals(db, version.version);
      requiresLegacySanitization = migratedRecipients || migratedZalo;
      if (!requiresLegacySanitization)
        db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
    }
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_zalo_link_codes_principal_expiry ON zalo_link_codes (principal_id, expires_at)'
    );
    db.exec('COMMIT');
  } catch (error) {
    captureOpsException(error, {
      code: 'UNHANDLED_OPS_EXCEPTION',
      source: 'api',
      status: 500
    });
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  if (requiresLegacySanitization) {
    try {
      db.exec('VACUUM');
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'api',
        status: 500
      });
      db.close();
      throw error;
    }
  }
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);

  let knownRetentionMonitors: Set<string> | undefined;
  const store: OpsStore = {
    recordSample(sample) {
      knownRetentionMonitors?.add(sample.monitor);
      db.prepare(
        `INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code)
         VALUES (@monitor, @level, @observedAt, @latencyMs, @detailsJson, @errorCode)`
      ).run({
        monitor: sample.monitor,
        level: sample.level,
        observedAt: sample.observedAt,
        latencyMs: sample.latencyMs,
        detailsJson: JSON.stringify(jsonObject(sample.details)),
        errorCode: cap(sample.errorCode, 120)
      });
    },

    upsertIncident(input) {
      const active = db
        .prepare(
          "SELECT * FROM incidents WHERE dedupe_key = ? AND state != 'recovered' ORDER BY opened_at DESC LIMIT 1"
        )
        .get(input.dedupeKey) as Record<string, unknown> | undefined;
      const summary = cap(input.safeSummary, 500) ?? '';
      if (active) {
        const nextState = input.state;
        const updatedSummary =
          nextState === 'recovered' && active.safe_summary
            ? (active.safe_summary as string)
            : summary || (active.safe_summary as string);
        db.prepare(
          `UPDATE incidents SET level = ?, state = ?, occurrence_count = occurrence_count + 1,
            last_seen_at = ?, recovered_at = ?, safe_summary = ? WHERE id = ?`
        ).run(
          input.level,
          nextState,
          input.now,
          nextState === 'recovered' ? (input.recoveredAt ?? input.now) : null,
          updatedSummary,
          active.id
        );
        return incidentFromRow(
          db.prepare('SELECT * FROM incidents WHERE id = ?').get(active.id) as Record<
            string,
            unknown
          >
        );
      }

      const id = randomUUID();
      db.prepare(
        `INSERT INTO incidents
          (id, dedupe_key, monitor, level, state, occurrence_count, opened_at, last_seen_at,
           recovered_at, acknowledged_at, acknowledged_by, note, safe_summary)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
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
        summary
      );
      return incidentFromRow(
        db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown>
      );
    },

    reconcileIncidents(input) {
      const activeDedupeKey = input.activeDedupeKey ?? null;
      db.prepare(
        `UPDATE incidents
         SET state = 'recovered', recovered_at = ?, last_seen_at = ?
         WHERE monitor = ? AND state IN ('open', 'acknowledged')
           AND (? IS NULL OR dedupe_key != ?)`
      ).run(input.now, input.now, input.monitor, activeDedupeKey, activeDedupeKey);
    },

    getIncident(id) {
      const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      return row ? incidentFromRow(row) : undefined;
    },

    acknowledgeIncident(id, input) {
      const incident = store.getIncident(id);
      if (!incident) throw new Error('Incident not found');
      if (incident.state === 'recovered')
        throw new Error('Recovered incident cannot be acknowledged');
      db.prepare(
        `UPDATE incidents SET state = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, note = ? WHERE id = ?`
      ).run(input.now, input.accountId, cap(input.note, 500), id);
      store.recordAuditEvent({
        actorId: input.accountId,
        action: 'incident_acknowledged',
        target: id,
        details: { noteLength: String(input.note.length) },
        occurredAt: input.now
      });
      return store.getIncident(id)!;
    },

    enqueueDelivery(input) {
      const id = randomUUID();
      const createdAt = now().toISOString();
      db.prepare(
        `INSERT INTO alert_deliveries
          (id, incident_id, recipient_ciphertext, kind, state, attempt_count, next_attempt_at, last_error_code, created_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, NULL, ?)`
      ).run(
        id,
        input.incidentId,
        input.recipientCiphertext,
        input.kind,
        input.nextAttemptAt,
        createdAt
      );
      return deliveryFromRow(
        db.prepare('SELECT * FROM alert_deliveries WHERE id = ?').get(id) as Record<string, unknown>
      );
    },

    hasDelivery(input) {
      const row = db
        .prepare(
          `SELECT 1 FROM alert_deliveries WHERE incident_id = ? AND kind = ? ${input.since ? 'AND created_at >= ?' : ''} LIMIT 1`
        )
        .get(
          ...(input.since
            ? [input.incidentId, input.kind, input.since]
            : [input.incidentId, input.kind])
        );
      return Boolean(row);
    },

    claimDueDeliveries(nowIso, limit) {
      const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
      const transaction = db.transaction(() => {
        const rows = db
          .prepare(
            `SELECT * FROM alert_deliveries
             WHERE next_attempt_at <= ? AND ((state = 'queued') OR (state IN ('failed', 'delivery_ambiguous') AND attempt_count < 5))
             ORDER BY next_attempt_at ASC LIMIT ?`
          )
          .all(nowIso, boundedLimit) as Array<Record<string, unknown>>;
        const claimed: AlertDeliveryRecord[] = [];
        for (const row of rows) {
          db.prepare(
            "UPDATE alert_deliveries SET state = 'sending', attempt_count = attempt_count + 1 WHERE id = ?"
          ).run(row.id);
          claimed.push(
            deliveryRecordFromRow(
              db.prepare('SELECT * FROM alert_deliveries WHERE id = ?').get(row.id) as Record<
                string,
                unknown
              >
            )
          );
        }
        return claimed;
      });
      return transaction();
    },

    completeDelivery(id) {
      db.prepare(
        "UPDATE alert_deliveries SET state = 'sent', last_error_code = NULL WHERE id = ?"
      ).run(id);
    },

    failDelivery(id, input) {
      db.prepare(
        'UPDATE alert_deliveries SET state = ?, last_error_code = ?, next_attempt_at = ? WHERE id = ?'
      ).run(input.state, cap(input.errorCode, 120), input.nextAttemptAt, id);
    },

    recordAuditEvent(input) {
      db.prepare(
        'INSERT INTO audit_events (actor_id, action, target, details_json, occurred_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        input.actorId,
        input.action,
        input.target.slice(0, 200),
        JSON.stringify(input.details),
        input.occurredAt
      );
    },

    listAuditEvents() {
      return db
        .prepare(
          'SELECT actor_id as actorId, action, target, occurred_at as occurredAt FROM audit_events ORDER BY id ASC'
        )
        .all() as Array<{
        actorId: string | null;
        action: string;
        target: string;
        occurredAt: string;
      }>;
    },

    readDashboardOverview() {
      const rows = db
        .prepare(
          `SELECT s.* FROM monitor_samples s
           INNER JOIN (SELECT monitor, MAX(observed_at) AS latest FROM monitor_samples GROUP BY monitor) latest
           ON latest.monitor = s.monitor AND latest.latest = s.observed_at`
        )
        .all() as Array<Record<string, unknown>>;
      const latestByMonitor: DashboardOverview['latestByMonitor'] = {};
      for (const row of rows) latestByMonitor[row.monitor as MonitorName] = sampleFromRow(row);
      const collectedAt =
        rows.length === 0
          ? null
          : rows.reduce(
              (latest, row) =>
                (row.observed_at as string) > latest ? (row.observed_at as string) : latest,
              ''
            );
      const incidents = db
        .prepare(
          "SELECT * FROM incidents WHERE state IN ('open', 'acknowledged') ORDER BY last_seen_at DESC"
        )
        .all() as Array<Record<string, unknown>>;
      const deliveries = db
        .prepare('SELECT * FROM alert_deliveries ORDER BY created_at DESC LIMIT 50')
        .all() as Array<Record<string, unknown>>;
      return {
        collectedAt,
        latestByMonitor,
        openIncidents: incidents.map(incidentFromRow),
        recentDeliveries: deliveries.map(deliveryFromRow)
      };
    },

    readInfrastructureHistory(input) {
      const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
      if (
        !isoTimestamp.test(input.from) ||
        !isoTimestamp.test(input.to) ||
        !Number.isFinite(Date.parse(input.from)) ||
        !Number.isFinite(Date.parse(input.to))
      )
        throw new Error('Invalid infrastructure history timestamp');
      const fromMs = Date.parse(input.from);
      const toMs = Date.parse(input.to);
      if (fromMs > toMs) throw new Error('Invalid infrastructure history range');
      if (![60, 300, 1800, 7200].includes(input.resolutionSeconds))
        throw new Error('Invalid infrastructure history resolution');
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 720)
        throw new Error('Invalid infrastructure history limit');
      const cutoff = now().getTime() - 30 * 24 * 60 * 60 * 1000;
      const from = new Date(Math.max(fromMs, cutoff)).toISOString();
      const to = new Date(toMs).toISOString();
      const rows = db
        .prepare(
          `SELECT
           CAST(CAST(strftime('%s', observed_at) AS INTEGER) / @resolution AS INTEGER) * @resolution AS bucket_epoch,
           AVG(CASE WHEN json_type(details_json, '$.cpuPercent') IN ('integer','real') THEN json_extract(details_json, '$.cpuPercent') END) AS cpu_percent,
           AVG(CASE WHEN json_type(details_json, '$.memoryPercent') IN ('integer','real') THEN json_extract(details_json, '$.memoryPercent') END) AS memory_percent,
           AVG(CASE WHEN json_type(details_json, '$.diskPercent') IN ('integer','real') THEN json_extract(details_json, '$.diskPercent') END) AS disk_percent,
           AVG(CASE WHEN json_type(details_json, '$.load1') IN ('integer','real') THEN json_extract(details_json, '$.load1') END) AS load_1,
           AVG(CASE WHEN json_type(details_json, '$.networkReceiveBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.networkReceiveBytesPerSecond') END) AS network_receive,
           AVG(CASE WHEN json_type(details_json, '$.networkTransmitBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.networkTransmitBytesPerSecond') END) AS network_transmit,
           AVG(CASE WHEN json_type(details_json, '$.diskReadBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.diskReadBytesPerSecond') END) AS disk_read,
           AVG(CASE WHEN json_type(details_json, '$.diskWriteBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.diskWriteBytesPerSecond') END) AS disk_write
         FROM monitor_samples
         WHERE monitor = 'host_resources' AND observed_at >= @from AND observed_at <= @to
         GROUP BY bucket_epoch
         ORDER BY bucket_epoch ASC
         LIMIT @limit`
        )
        .all({ from, to, resolution: input.resolutionSeconds, limit: input.limit }) as Array<
        Record<string, unknown>
      >;
      const numberOrNull = (value: unknown): number | null =>
        typeof value === 'number' && Number.isFinite(value) ? value : null;
      return rows.map((row) => ({
        observedAt: new Date(Number(row.bucket_epoch) * 1000).toISOString(),
        cpuPercent: numberOrNull(row.cpu_percent),
        memoryPercent: numberOrNull(row.memory_percent),
        diskPercent: numberOrNull(row.disk_percent),
        load1: numberOrNull(row.load_1),
        networkReceiveBytesPerSecond: numberOrNull(row.network_receive),
        networkTransmitBytesPerSecond: numberOrNull(row.network_transmit),
        diskReadBytesPerSecond: numberOrNull(row.disk_read),
        diskWriteBytesPerSecond: numberOrNull(row.disk_write)
      }));
    },

    getCursor(source) {
      const row = db
        .prepare('SELECT inode, offset FROM collector_cursors WHERE source = ?')
        .get(source) as { inode: number; offset: number } | undefined;
      return row;
    },

    setCursor(source, cursor) {
      db.prepare(
        `INSERT INTO collector_cursors (source, inode, offset) VALUES (?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET inode = excluded.inode, offset = excluded.offset`
      ).run(source, Math.max(0, Math.floor(cursor.inode)), Math.max(0, Math.floor(cursor.offset)));
    },

    pruneRetentionBatch(nowDate = now().toISOString()) {
      const nowMs = Date.parse(nowDate);
      if (!Number.isFinite(nowMs)) throw new Error('Invalid retention timestamp');

      type RetentionStateRow = {
        raw_cutoff: string | null;
        rollup_cutoff: string | null;
        event_cutoff: string | null;
        last_completed_at: string | null;
      };
      type RawSampleRow = {
        id: number;
        monitor: string;
        level: string;
        observed_at: string;
      };
      type RollupStageRow = {
        day: string;
        monitor: string;
        sample_count: number;
        last_observed_at: string;
        last_level: string;
      };
      const readState = () =>
        db
          .prepare(
            'SELECT raw_cutoff, rollup_cutoff, event_cutoff, last_completed_at FROM retention_state WHERE singleton = 1'
          )
          .get() as RetentionStateRow | undefined;

      let state = readState();
      if (!state) throw new Error('Retention state is unavailable');
      if (state.raw_cutoff === null) {
        const lastCompletedMs = state.last_completed_at ? Date.parse(state.last_completed_at) : NaN;
        if (Number.isFinite(lastCompletedMs) && nowMs - lastCompletedMs < RETENTION_INTERVAL_MS)
          return { status: 'not_due', rows: 0 };

        const rawCutoff = new Date(nowMs - 30 * 24 * 60 * 60 * 1_000).toISOString();
        const rollupCutoff = new Date(nowMs - 365 * 24 * 60 * 60 * 1_000).toISOString();
        const eventCutoff = new Date(nowMs - 90 * 24 * 60 * 60 * 1_000).toISOString();
        const startRun = db.transaction(() => {
          const current = readState();
          if (!current) throw new Error('Retention state is unavailable');
          if (current.raw_cutoff !== null) return current;
          const completedAt = current.last_completed_at
            ? Date.parse(current.last_completed_at)
            : NaN;
          if (Number.isFinite(completedAt) && nowMs - completedAt < RETENTION_INTERVAL_MS)
            return current;
          db.prepare(
            `UPDATE retention_state
             SET raw_cutoff = ?, rollup_cutoff = ?, event_cutoff = ?
             WHERE singleton = 1 AND raw_cutoff IS NULL`
          ).run(rawCutoff, rollupCutoff, eventCutoff);
          const started = readState();
          if (!started) throw new Error('Retention state is unavailable');
          return started;
        });
        state = startRun.immediate();
        if (state.raw_cutoff === null) return { status: 'not_due', rows: 0 };
      }

      const rawCutoff = state.raw_cutoff;
      const rollupCutoff = state.rollup_cutoff;
      const eventCutoff = state.event_cutoff;
      if (!rawCutoff || !rollupCutoff || !eventCutoff)
        throw new Error('Retention run cutoffs are incomplete');

      if (!knownRetentionMonitors) {
        const monitors = db.prepare('SELECT DISTINCT monitor FROM monitor_samples').all() as Array<{
          monitor: string;
        }>;
        knownRetentionMonitors = new Set(monitors.map((row) => row.monitor));
      }

      const rawRowsByMonitor = [...knownRetentionMonitors].flatMap(
        (monitor) =>
          db
            .prepare(
              `SELECT id, monitor, level, observed_at FROM monitor_samples
             WHERE monitor = ? AND observed_at < ?
             ORDER BY observed_at ASC, id ASC LIMIT ?`
            )
            .all(monitor, rawCutoff, RETENTION_BATCH_SIZE) as RawSampleRow[]
      );
      rawRowsByMonitor.sort(
        (left, right) => left.observed_at.localeCompare(right.observed_at) || left.id - right.id
      );
      const selectedRawRows = rawRowsByMonitor.slice(0, RETENTION_BATCH_SIZE);
      if (selectedRawRows.length > 0) {
        const ids = selectedRawRows.map((row) => row.id);
        const placeholders = ids.map(() => '?').join(', ');
        const processRawBatch = db.transaction(() => {
          const currentRows = db
            .prepare(
              `SELECT id, monitor, level, observed_at FROM monitor_samples
               WHERE id IN (${placeholders}) AND observed_at < ?
               ORDER BY observed_at ASC, id ASC`
            )
            .all(...ids, rawCutoff) as RawSampleRow[];
          const groups = new Map<
            string,
            {
              day: string;
              monitor: string;
              sampleCount: number;
              lastObservedAt: string;
              rank: number;
            }
          >();
          for (const row of currentRows) {
            if (row.observed_at < rollupCutoff) continue;
            const day = row.observed_at.slice(0, 10);
            const key = `${day}\u0000${row.monitor}`;
            const current = groups.get(key);
            if (current) {
              current.sampleCount += 1;
              if (row.observed_at > current.lastObservedAt)
                current.lastObservedAt = row.observed_at;
              current.rank = Math.max(current.rank, retentionLevelRank(row.level));
            } else {
              groups.set(key, {
                day,
                monitor: row.monitor,
                sampleCount: 1,
                lastObservedAt: row.observed_at,
                rank: retentionLevelRank(row.level)
              });
            }
          }
          const stageUpsert = db.prepare(
            `INSERT INTO retention_rollup_stage (day, monitor, sample_count, last_observed_at, last_level)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(day, monitor) DO UPDATE SET
               sample_count = retention_rollup_stage.sample_count + excluded.sample_count,
               last_observed_at = MAX(retention_rollup_stage.last_observed_at, excluded.last_observed_at),
               last_level = CASE MAX(
                 CASE retention_rollup_stage.last_level WHEN 'critical' THEN 4 WHEN 'warning' THEN 3 WHEN 'healthy' THEN 2 ELSE 1 END,
                 CASE excluded.last_level WHEN 'critical' THEN 4 WHEN 'warning' THEN 3 WHEN 'healthy' THEN 2 ELSE 1 END
               ) WHEN 4 THEN 'critical' WHEN 3 THEN 'warning' WHEN 2 THEN 'healthy' ELSE 'unknown' END`
          );
          for (const group of groups.values())
            stageUpsert.run(
              group.day,
              group.monitor,
              group.sampleCount,
              group.lastObservedAt,
              retentionLevelFromRank(group.rank)
            );
          const deleteSelected = db.prepare(
            `DELETE FROM monitor_samples WHERE id IN (${placeholders}) AND observed_at < ?`
          );
          return deleteSelected.run(...ids, rawCutoff).changes;
        });
        const rows = processRawBatch.immediate();
        if (rows > 0) return { status: 'batch', table: 'monitor_samples', rows };
      }

      const mergeStageBatch = db.transaction(() => {
        const staged = db
          .prepare(
            `SELECT day, monitor, sample_count, last_observed_at, last_level
             FROM retention_rollup_stage ORDER BY day ASC, monitor ASC LIMIT ?`
          )
          .all(RETENTION_BATCH_SIZE) as RollupStageRow[];
        if (staged.length === 0) return 0;
        const upsert = db.prepare(
          `INSERT INTO daily_rollups (day, monitor, sample_count, last_observed_at, last_level)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(day, monitor) DO UPDATE SET
             sample_count = daily_rollups.sample_count + excluded.sample_count,
             last_observed_at = MAX(daily_rollups.last_observed_at, excluded.last_observed_at),
             last_level = excluded.last_level`
        );
        const deleteStage = db.prepare(
          'DELETE FROM retention_rollup_stage WHERE day = ? AND monitor = ?'
        );
        for (const row of staged) {
          upsert.run(row.day, row.monitor, row.sample_count, row.last_observed_at, row.last_level);
          deleteStage.run(row.day, row.monitor);
        }
        return staged.length;
      });
      const mergedRows = mergeStageBatch.immediate();
      if (mergedRows > 0) return { status: 'batch', table: 'daily_rollups', rows: mergedRows };

      const deleteOldestBatch = (
        table: string,
        where: string,
        orderBy: string,
        cutoff: string
      ): number => {
        const rowIdSelection = table === 'audit_events' ? 'id AS rowid' : 'rowid';
        const selected = db
          .prepare(
            `SELECT ${rowIdSelection} FROM ${table} WHERE ${where}
             ORDER BY ${orderBy}, rowid ASC LIMIT ?`
          )
          .all(cutoff, RETENTION_BATCH_SIZE) as Array<{ rowid: number }>;
        if (selected.length === 0) return 0;
        const rowids = selected.map((row) => row.rowid);
        const placeholders = rowids.map(() => '?').join(', ');
        const remove = db.transaction(
          () =>
            db
              .prepare(`DELETE FROM ${table} WHERE rowid IN (${placeholders}) AND ${where}`)
              .run(...rowids, cutoff).changes
        );
        return remove.immediate();
      };

      const cleanupBatches: Array<{
        table: string;
        where: string;
        orderBy: string;
        cutoff: string;
      }> = [
        {
          table: 'daily_rollups',
          where: 'day < substr(?, 1, 10)',
          orderBy: 'day ASC, monitor ASC',
          cutoff: rollupCutoff
        },
        {
          table: 'incidents',
          where: "state = 'recovered' AND last_seen_at < ?",
          orderBy: 'last_seen_at ASC',
          cutoff: eventCutoff
        },
        {
          table: 'alert_deliveries',
          where: "state IN ('sent', 'failed', 'delivery_ambiguous') AND next_attempt_at < ?",
          orderBy: 'next_attempt_at ASC',
          cutoff: eventCutoff
        },
        // User decision 2026-10-31: prune audit events after 90 days.
        {
          table: 'audit_events',
          where: 'occurred_at < ?',
          orderBy: 'occurred_at ASC',
          cutoff: eventCutoff
        },
        {
          table: 'login_attempts',
          where: 'attempted_at < ?',
          orderBy: 'attempted_at ASC',
          cutoff: eventCutoff
        }
      ];
      for (const cleanup of cleanupBatches) {
        const rows = deleteOldestBatch(
          cleanup.table,
          cleanup.where,
          cleanup.orderBy,
          cleanup.cutoff
        );
        if (rows > 0) return { status: 'batch', table: cleanup.table, rows };
      }

      const finishRun = db.transaction(() => {
        db.prepare(
          `UPDATE retention_state
           SET raw_cutoff = NULL, rollup_cutoff = NULL, event_cutoff = NULL, last_completed_at = ?
           WHERE singleton = 1`
        ).run(nowDate);
      });
      finishRun.immediate();
      return { status: 'complete', rows: 0 };
    },

    createAccount(input) {
      db.prepare(
        'INSERT INTO accounts (id, username, password_hash, totp_secret_enc, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, NULL)'
      ).run(input.id, input.username, input.passwordHash, input.totpSecretEnc, input.createdAt);
    },

    findAccountByUsername(username) {
      const row = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as
        | Record<string, unknown>
        | undefined;
      return row
        ? {
            id: row.id as string,
            username: row.username as string,
            passwordHash: row.password_hash as string,
            totpSecretEnc: row.totp_secret_enc as string,
            createdAt: row.created_at as string,
            disabledAt: (row.disabled_at as string | null) ?? null
          }
        : undefined;
    },

    findAccountById(id) {
      return store.findAccountByUsername(
        (
          db.prepare('SELECT username FROM accounts WHERE id = ?').get(id) as
            | { username: string }
            | undefined
        )?.username ?? ''
      );
    },

    recoverAccountCredentials(input) {
      db.transaction(() => {
        db.prepare(
          'UPDATE accounts SET password_hash = ?, totp_secret_enc = ?, disabled_at = NULL WHERE id = ?'
        ).run(input.passwordHash, input.totpSecretEnc, input.accountId);
        db.prepare('DELETE FROM login_attempts WHERE username = ?').run(input.username);
        db.prepare('DELETE FROM sessions WHERE account_id = ?').run(input.accountId);
      })();
    },

    createSession(input) {
      db.prepare(
        `INSERT INTO sessions (token_hash, account_id, csrf_token, csrf_token_hash, created_at, last_seen_at, expires_at, absolute_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.tokenHash,
        input.accountId,
        input.csrfToken,
        input.csrfTokenHash,
        input.createdAt,
        input.lastSeenAt,
        input.expiresAt,
        input.absoluteExpiresAt
      );
    },

    findSession(tokenHash) {
      const row = db
        .prepare(
          `SELECT s.*, a.username FROM sessions s INNER JOIN accounts a ON a.id = s.account_id
           WHERE s.token_hash = ?`
        )
        .get(tokenHash) as Record<string, unknown> | undefined;
      return row
        ? {
            tokenHash: row.token_hash as string,
            accountId: row.account_id as string,
            csrfToken: row.csrf_token as string,
            csrfTokenHash: row.csrf_token_hash as string,
            createdAt: row.created_at as string,
            lastSeenAt: row.last_seen_at as string,
            expiresAt: row.expires_at as string,
            absoluteExpiresAt: row.absolute_expires_at as string,
            username: row.username as string
          }
        : undefined;
    },

    touchSession(tokenHash, lastSeenAt, expiresAt) {
      db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(
        lastSeenAt,
        expiresAt,
        tokenHash
      );
    },

    deleteSession(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },

    countRecentFailedLogins(username, since) {
      return (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM login_attempts WHERE username = ? AND attempted_at >= ? AND success = 0'
          )
          .get(username, since) as { count: number }
      ).count;
    },

    recordLoginAttempt(input) {
      db.prepare(
        'INSERT INTO login_attempts (username, attempted_at, success) VALUES (?, ?, ?)'
      ).run(input.username, input.attemptedAt, input.success ? 1 : 0);
    },

    createZaloLinkCode(input) {
      const principalId = input.principalId ?? input.accountId;
      if (!principalId) throw new Error('Zalo principal is required');
      db.prepare(
        `INSERT INTO zalo_link_codes (code_hash, principal_id, expires_at, created_at, consumed_at)
         VALUES (?, ?, ?, ?, NULL)`
      ).run(input.codeHash, principalId, input.expiresAt, input.createdAt);
    },

    getZaloLinkStatus(principalId) {
      const row = db
        .prepare(
          'SELECT linked_at, last_seen_at FROM zalo_links WHERE principal_id = ? AND disabled_at IS NULL'
        )
        .get(principalId) as { linked_at: string; last_seen_at: string } | undefined;
      return row ? { linkedAt: row.linked_at, lastSeenAt: row.last_seen_at } : undefined;
    },

    consumeZaloLink(input) {
      const transaction = db.transaction((): ZaloLinkConsumeResult => {
        if (db.prepare('SELECT 1 FROM zalo_webhook_events WHERE event_id = ?').get(input.eventId)) {
          return { outcome: 'already_processed' };
        }
        const code = db
          .prepare(
            'SELECT principal_id, expires_at, consumed_at FROM zalo_link_codes WHERE code_hash = ?'
          )
          .get(input.codeHash) as
          | { principal_id: string; expires_at: string; consumed_at: string | null }
          | undefined;
        if (!code || code.consumed_at || Date.parse(code.expires_at) <= Date.parse(input.now)) {
          return { outcome: 'invalid_code' };
        }
        const existingClaim = db
          .prepare(
            'SELECT principal_id FROM zalo_links WHERE chat_id_hash = ? AND disabled_at IS NULL'
          )
          .get(input.chatIdHash) as { principal_id: string } | undefined;
        if (existingClaim && existingClaim.principal_id !== code.principal_id) {
          return { outcome: 'chat_already_linked' };
        }
        db.prepare(
          `INSERT INTO zalo_links (principal_id, chat_id_hash, chat_id_ciphertext, linked_at, last_seen_at, disabled_at)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT(principal_id) DO UPDATE SET
             chat_id_hash = excluded.chat_id_hash,
             chat_id_ciphertext = excluded.chat_id_ciphertext,
             linked_at = excluded.linked_at,
             last_seen_at = excluded.last_seen_at,
             disabled_at = NULL`
        ).run(code.principal_id, input.chatIdHash, input.chatIdCiphertext, input.now, input.now);
        db.prepare('UPDATE zalo_link_codes SET consumed_at = ? WHERE code_hash = ?').run(
          input.now,
          input.codeHash
        );
        db.prepare(
          'INSERT INTO zalo_webhook_events (event_id, principal_id, created_at) VALUES (?, ?, ?)'
        ).run(input.eventId, code.principal_id, input.now);
        return {
          outcome: 'linked',
          principalId: code.principal_id,
          accountId: code.principal_id,
          linkedAt: input.now
        };
      });
      return transaction();
    },

    disableZaloLink(principalId, disabledAt) {
      db.prepare(
        'UPDATE zalo_links SET disabled_at = ?, last_seen_at = ? WHERE principal_id = ? AND disabled_at IS NULL'
      ).run(disabledAt, disabledAt, principalId);
    },

    listActiveZaloRecipients() {
      return (
        db
          .prepare(
            `SELECT chat_id_hash, chat_id_ciphertext
             FROM zalo_links WHERE disabled_at IS NULL ORDER BY linked_at ASC`
          )
          .all() as Array<{ chat_id_hash: string; chat_id_ciphertext: string }>
      ).map((row) => ({
        recipientHash: row.chat_id_hash,
        recipientCiphertext: row.chat_id_ciphertext
      }));
    },

    getDatabaseForBackup() {
      return db;
    }
  };
  return store;
}
