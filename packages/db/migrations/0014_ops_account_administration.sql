ALTER TABLE ops_users
  RENAME COLUMN locked_until TO login_blocked_until;

ALTER TABLE ops_users
  ADD COLUMN administratively_locked_at timestamptz,
  ADD COLUMN administratively_locked_by uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  ADD COLUMN lock_reason text,
  ADD COLUMN revoked_by uuid REFERENCES ops_users(id) ON DELETE RESTRICT;

ALTER TABLE ops_mfa_enrollment_tokens
  DROP CONSTRAINT IF EXISTS ops_mfa_enrollment_tokens_purpose_check;

ALTER TABLE ops_mfa_enrollment_tokens
  ADD CONSTRAINT ops_mfa_enrollment_tokens_purpose_check
  CHECK (purpose IN ('bootstrap', 'recovery', 'invite'));

CREATE TABLE ops_account_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created','role_changed','administratively_locked','recovery_issued','activated','revoked'
  )),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_account_events_user_occurred_idx
  ON ops_account_events (user_id, occurred_at DESC);
