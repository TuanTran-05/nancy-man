CREATE TABLE ops_config_changes (
  id uuid PRIMARY KEY,
  supersedes_change_id uuid REFERENCES ops_config_changes(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  actor_session_id uuid NOT NULL REFERENCES ops_sessions(id) ON DELETE RESTRICT,
  application_id text NOT NULL CHECK (application_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  state text NOT NULL CHECK (state IN (
    'DRAFT', 'VALIDATING', 'INVALID', 'READY', 'SAVED', 'APPLYING',
    'SNAPSHOTTED', 'WRITTEN', 'ACTION_RUNNING', 'HEALTH_CHECKING', 'COMPLETED',
    'ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED', 'CANCELLED', 'EXPIRED'
  )),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  change_digest text CHECK (change_digest IS NULL OR change_digest ~ '^hmac-sha256:v[0-9]+:[0-9a-f]{64}$'),
  catalog_version text NOT NULL CHECK (char_length(btrim(catalog_version)) BETWEEN 1 AND 128),
  manifest_version text NOT NULL CHECK (char_length(btrim(manifest_version)) BETWEEN 1 AND 128),
  key_version text NOT NULL CHECK (char_length(btrim(key_version)) BETWEEN 1 AND 128),
  impact_plan jsonb NOT NULL CHECK (
    jsonb_typeof(impact_plan) = 'object' AND
    (impact_plan - ARRAY[
      'applicationId', 'sourceIds', 'actionIds', 'checkIds', 'strategies',
      'counts', 'warnings', 'expectedEffect'
    ]) = '{}'::jsonb
  ),
  agent_envelope_id text CHECK (agent_envelope_id IS NULL OR agent_envelope_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE INDEX ops_config_changes_application_state_idx
  ON ops_config_changes (application_id, state);

CREATE UNIQUE INDEX ops_config_changes_one_active_apply_idx
  ON ops_config_changes (application_id)
  WHERE state IN ('APPLYING', 'SNAPSHOTTED', 'WRITTEN', 'ACTION_RUNNING', 'HEALTH_CHECKING', 'ROLLING_BACK');

CREATE TABLE ops_config_change_items (
  id uuid PRIMARY KEY,
  change_id uuid NOT NULL REFERENCES ops_config_changes(id) ON DELETE CASCADE,
  source_id text NOT NULL CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  catalog_id text NOT NULL CHECK (catalog_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  operation text NOT NULL CHECK (operation IN ('set', 'delete')),
  requirement text NOT NULL CHECK (requirement IN ('required', 'optional')),
  strategy text NOT NULL CHECK (strategy IN (
    'no_runtime_action', 'next_job', 'runtime_restart', 'credential_restart', 'build_redeploy'
  )),
  old_value_fingerprint text CHECK (old_value_fingerprint IS NULL OR old_value_fingerprint ~ '^hmac-sha256:v[0-9]+:[0-9a-f]{64}$'),
  new_value_fingerprint text CHECK (new_value_fingerprint IS NULL OR new_value_fingerprint ~ '^hmac-sha256:v[0-9]+:[0-9a-f]{64}$'),
  observed_source_fingerprint text NOT NULL CHECK (observed_source_fingerprint ~ '^hmac-sha256:v[0-9]+:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((operation = 'set' AND new_value_fingerprint IS NOT NULL) OR (operation = 'delete' AND new_value_fingerprint IS NULL)),
  CHECK (operation <> 'delete' OR requirement = 'optional')
);

CREATE UNIQUE INDEX ops_config_change_items_change_catalog_idx
  ON ops_config_change_items (change_id, catalog_id);
CREATE INDEX ops_config_change_items_change_source_idx
  ON ops_config_change_items (change_id, source_id);

CREATE TABLE ops_config_runs (
  id uuid PRIMARY KEY,
  change_id uuid NOT NULL REFERENCES ops_config_changes(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  transition_id uuid NOT NULL,
  event_id uuid NOT NULL,
  sequence_number bigint NOT NULL CHECK (sequence_number > 0),
  from_state text NOT NULL CHECK (from_state IN (
    'DRAFT', 'VALIDATING', 'INVALID', 'READY', 'SAVED', 'APPLYING',
    'SNAPSHOTTED', 'WRITTEN', 'ACTION_RUNNING', 'HEALTH_CHECKING', 'COMPLETED',
    'ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED', 'CANCELLED', 'EXPIRED'
  )),
  state text NOT NULL CHECK (state IN (
    'DRAFT', 'VALIDATING', 'INVALID', 'READY', 'SAVED', 'APPLYING',
    'SNAPSHOTTED', 'WRITTEN', 'ACTION_RUNNING', 'HEALTH_CHECKING', 'COMPLETED',
    'ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED', 'CANCELLED', 'EXPIRED'
  )),
  actor_user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  actor_session_id uuid NOT NULL REFERENCES ops_sessions(id) ON DELETE RESTRICT,
  action_id text CHECK (action_id IS NULL OR action_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  check_id text CHECK (check_id IS NULL OR check_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  result_code text CHECK (result_code IS NULL OR result_code ~ '^[A-Z0-9][A-Z0-9._:-]{0,127}$'),
  result_summary text CHECK (result_summary IS NULL OR char_length(btrim(result_summary)) BETWEEN 1 AND 500),
  snapshot_reference text CHECK (snapshot_reference IS NULL OR snapshot_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  rollback_result text CHECK (rollback_result IS NULL OR rollback_result IN ('not_started', 'succeeded', 'failed')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_id, transition_id),
  UNIQUE (change_id, event_id),
  UNIQUE (change_id, sequence_number)
);

CREATE INDEX ops_config_runs_change_occurred_idx
  ON ops_config_runs (change_id, occurred_at, sequence_number);

CREATE OR REPLACE FUNCTION _ops_config_runs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OPS_CONFIG_RUNS_APPEND_ONLY';
END;
$$;

CREATE TRIGGER ops_config_runs_append_only_trigger
  BEFORE UPDATE OR DELETE ON ops_config_runs
  FOR EACH ROW EXECUTE FUNCTION _ops_config_runs_append_only();

CREATE TABLE ops_config_application_blocks (
  application_id text PRIMARY KEY CHECK (application_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  failed_run_id uuid NOT NULL REFERENCES ops_config_runs(id) ON DELETE RESTRICT,
  failed_change_id uuid NOT NULL REFERENCES ops_config_changes(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9][A-Z0-9._:-]{2,127}$'),
  blocked_actor_user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_actor_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  acknowledged_at timestamptz,
  cleared_actor_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  cleared_at timestamptz,
  clear_remediation_summary text,
  CHECK ((acknowledged_actor_user_id IS NULL AND acknowledged_at IS NULL) OR (acknowledged_actor_user_id IS NOT NULL AND acknowledged_at IS NOT NULL)),
  CHECK ((cleared_actor_user_id IS NULL AND cleared_at IS NULL AND clear_remediation_summary IS NULL) OR
         (cleared_actor_user_id IS NOT NULL AND cleared_at IS NOT NULL AND char_length(btrim(clear_remediation_summary)) BETWEEN 3 AND 2000))
);

CREATE INDEX ops_config_application_blocks_active_idx
  ON ops_config_application_blocks (application_id)
  WHERE cleared_at IS NULL;
