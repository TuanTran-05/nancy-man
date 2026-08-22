CREATE TABLE IF NOT EXISTS sql_executions (
  id uuid PRIMARY KEY,
  execution_key text NOT NULL UNIQUE,
  actor_user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES ops_sessions(id) ON DELETE RESTRICT,
  execution_kind text NOT NULL CHECK (execution_kind IN ('read', 'dml', 'ddl', 'special', 'recovery')),
  status text NOT NULL CHECK (status IN ('previewed', 'running', 'succeeded', 'failed', 'cancelled', 'drifted', 'rolled_back')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  original_sql_ciphertext bytea,
  redacted_sql text NOT NULL,
  normalized_fingerprint char(64) NOT NULL,
  issue_id uuid REFERENCES error_issues(id) ON DELETE RESTRICT,
  incident_id uuid REFERENCES incidents(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer CHECK (duration_ms >= 0),
  affected_rows bigint CHECK (affected_rows >= 0),
  result_truncated boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sql_executions_actor_requested_idx ON sql_executions (actor_user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS sql_executions_issue_requested_idx ON sql_executions (issue_id, requested_at DESC) WHERE issue_id IS NOT NULL;
