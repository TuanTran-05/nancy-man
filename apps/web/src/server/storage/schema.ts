export const SCHEMA_VERSION = 4;

export const schemaSql = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1))
);

CREATE TABLE IF NOT EXISTS monitor_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor TEXT NOT NULL,
  level TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  latency_ms INTEGER,
  details_json TEXT NOT NULL,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  monitor TEXT NOT NULL,
  level TEXT NOT NULL,
  state TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL,
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  recovered_at TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  note TEXT,
  safe_summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id TEXT PRIMARY KEY,
  incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  recipient_ciphertext TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  details_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collector_cursors (
  source TEXT PRIMARY KEY,
  inode INTEGER NOT NULL,
  offset INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_rollups (
  day TEXT NOT NULL,
  monitor TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  last_observed_at TEXT NOT NULL,
  last_level TEXT NOT NULL,
  PRIMARY KEY (day, monitor)
);

CREATE TABLE IF NOT EXISTS zalo_link_codes (
  code_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS zalo_links (
  principal_id TEXT PRIMARY KEY,
  chat_id_hash TEXT NOT NULL UNIQUE,
  chat_id_ciphertext TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS zalo_webhook_events (
  event_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_samples_monitor_observed ON monitor_samples (monitor, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_state_seen ON incidents (state, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_due ON alert_deliveries (state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username_time ON login_attempts (username, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_zalo_links_active ON zalo_links (disabled_at, linked_at DESC);
`;
