CREATE TABLE IF NOT EXISTS ops_users (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (char_length(username) BETWEEN 3 AND 80),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  role text NOT NULL CHECK (role IN ('ops_viewer', 'ops_maintainer', 'ops_owner')),
  status text NOT NULL CHECK (status IN ('pending_mfa', 'active', 'locked', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  locked_until timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_users_username_ci_unique ON ops_users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS ops_users_email_ci_unique ON ops_users (lower(email));

CREATE TABLE IF NOT EXISTS ops_password_credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  password_fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  superseded_at timestamptz
);

CREATE INDEX IF NOT EXISTS ops_password_credentials_user_created_idx
  ON ops_password_credentials (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_mfa_factors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  factor_type text NOT NULL CHECK (factor_type IN ('webauthn', 'totp')),
  encrypted_secret bytea NOT NULL,
  credential_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_mfa_factors_active_label_unique
  ON ops_mfa_factors (user_id, factor_type, label)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  code_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  replaced_at timestamptz
);

CREATE TABLE IF NOT EXISTS ops_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  session_hash char(64) NOT NULL UNIQUE,
  csrf_secret_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  ip_hash char(64) NOT NULL,
  user_agent text NOT NULL
);

CREATE INDEX IF NOT EXISTS ops_sessions_user_active_idx
  ON ops_sessions (user_id, idle_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_login_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'locked', 'recovery_started', 'recovery_completed')),
  ip_hash char(64),
  user_agent text,
  reason_code text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ops_login_events_user_occurred_idx
  ON ops_login_events (user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS ops_elevation_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES ops_sessions(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('requested', 'granted', 'expired', 'revoked', 'reauthenticated')),
  reason text NOT NULL,
  mfa_factor_id uuid REFERENCES ops_mfa_factors(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ops_elevation_events_session_occurred_idx
  ON ops_elevation_events (session_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS ops_audit_entries (
  audit_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text,
  request_id text,
  ip_hash char(64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash char(64),
  entry_hash char(64) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ops_audit_checkpoints (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  audit_sequence bigint NOT NULL REFERENCES ops_audit_entries(audit_sequence) ON DELETE RESTRICT,
  entry_hash char(64) NOT NULL,
  signature bytea NOT NULL,
  signer_key_id text NOT NULL,
  exported_at timestamptz,
  off_host_object_key text
);

CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_name text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('production')),
  instance_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  release_sha char(40),
  status text NOT NULL CHECK (status IN ('ok', 'degraded', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (service_name, environment, instance_id)
);
