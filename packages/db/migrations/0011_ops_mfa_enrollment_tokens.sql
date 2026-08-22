CREATE TABLE IF NOT EXISTS ops_mfa_enrollment_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('bootstrap', 'recovery')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  issued_by_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ops_mfa_enrollment_tokens_active_idx
  ON ops_mfa_enrollment_tokens (token_hash, expires_at)
  WHERE used_at IS NULL;
