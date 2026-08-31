CREATE TABLE ops_secret_elevations (
  id uuid PRIMARY KEY,
  capability text NOT NULL CHECK (capability IN ('accounts_write', 'variables_secret', 'variables_apply')),
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES ops_sessions(id) ON DELETE RESTRICT,
  ip_hash char(64) NOT NULL,
  user_agent_hash char(64) NOT NULL,
  subject_digest char(64),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX ops_secret_elevations_active_idx
  ON ops_secret_elevations (session_id, capability, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
