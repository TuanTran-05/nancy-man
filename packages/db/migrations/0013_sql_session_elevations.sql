CREATE TABLE IF NOT EXISTS ops_sql_elevations (
  session_id uuid PRIMARY KEY REFERENCES ops_sessions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  mfa_factor_id uuid NOT NULL REFERENCES ops_mfa_factors(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 250),
  granted_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (idle_expires_at <= absolute_expires_at),
  CHECK (granted_at <= last_activity_at),
  CHECK (last_activity_at <= absolute_expires_at)
);
CREATE INDEX IF NOT EXISTS ops_sql_elevations_active_idx
  ON ops_sql_elevations (user_id, absolute_expires_at)
  WHERE revoked_at IS NULL;
