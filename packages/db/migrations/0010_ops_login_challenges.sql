CREATE TABLE IF NOT EXISTS ops_mfa_login_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  challenge_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  ip_hash char(64) NOT NULL,
  user_agent text NOT NULL
);

CREATE INDEX IF NOT EXISTS ops_mfa_login_challenges_active_idx
  ON ops_mfa_login_challenges (challenge_hash, expires_at)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS ops_login_events_ip_occurred_idx
  ON ops_login_events (ip_hash, occurred_at DESC);
