CREATE TABLE IF NOT EXISTS ingest_clients (
  id uuid PRIMARY KEY,
  client_name text NOT NULL UNIQUE CHECK (char_length(client_name) BETWEEN 3 AND 160),
  client_kind text NOT NULL CHECK (client_kind IN ('browser', 'server', 'worker', 'synthetic')),
  service_name text NOT NULL CHECK (char_length(service_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'rotated')),
  public_key_id text,
  secret_reference text,
  allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  rotated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ingest_idempotency (
  ingest_client_id uuid NOT NULL REFERENCES ingest_clients(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 255),
  event_id text NOT NULL UNIQUE CHECK (char_length(event_id) BETWEEN 8 AND 64),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  payload_hash char(64) NOT NULL,
  PRIMARY KEY (ingest_client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ingest_envelopes (
  id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  ingest_client_id uuid NOT NULL REFERENCES ingest_clients(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  event_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('browser', 'api', 'database', 'job', 'provider', 'process', 'synthetic')),
  request_id text,
  trace_id text,
  release_id uuid,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL,
  PRIMARY KEY (id, received_at),
  FOREIGN KEY (ingest_client_id, idempotency_key)
    REFERENCES ingest_idempotency (ingest_client_id, idempotency_key) ON DELETE RESTRICT
) PARTITION BY RANGE (received_at);

CREATE INDEX IF NOT EXISTS ingest_envelopes_event_received_idx
  ON ingest_envelopes (event_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ingest_envelopes_client_received_idx
  ON ingest_envelopes (ingest_client_id, received_at DESC);

CREATE TABLE IF NOT EXISTS releases (
  id uuid PRIMARY KEY,
  service_name text NOT NULL,
  release_sha char(40) NOT NULL,
  build_id text NOT NULL,
  deployed_at timestamptz NOT NULL,
  source_map_version text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (service_name, release_sha)
);

CREATE TABLE IF NOT EXISTS error_issues (
  id uuid PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  title text NOT NULL,
  error_code text,
  exception_type text,
  source text NOT NULL CHECK (source IN ('browser', 'api', 'database', 'job', 'provider', 'process', 'synthetic')),
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'acknowledged', 'investigating', 'resolved', 'ignored', 'regressed')),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrence_count bigint NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
  affected_user_count bigint NOT NULL DEFAULT 0 CHECK (affected_user_count >= 0),
  first_release_id uuid REFERENCES releases(id) ON DELETE RESTRICT,
  last_release_id uuid REFERENCES releases(id) ON DELETE RESTRICT,
  assigned_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  ignored_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS error_issues_inbox_idx
  ON error_issues (status, severity, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS error_events (
  id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  event_id text NOT NULL,
  issue_id uuid NOT NULL REFERENCES error_issues(id) ON DELETE RESTRICT,
  ingest_client_id uuid NOT NULL REFERENCES ingest_clients(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('browser', 'api', 'database', 'job', 'provider', 'process', 'synthetic')),
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  request_id text,
  trace_id text,
  release_id uuid REFERENCES releases(id) ON DELETE RESTRICT,
  user_reference text,
  session_hash char(64),
  route text,
  method text,
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  error_code text,
  exception_type text,
  safe_message text NOT NULL,
  stack_trace text,
  component_stack text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  breadcrumbs jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS error_events_issue_occurred_idx
  ON error_events (issue_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS error_events_event_occurred_idx
  ON error_events (event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS error_events_request_occurred_idx
  ON error_events (request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS error_issue_activity (
  id uuid PRIMARY KEY,
  issue_id uuid NOT NULL REFERENCES error_issues(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  activity_type text NOT NULL CHECK (activity_type IN (
    'created', 'acknowledged', 'assigned', 'unassigned', 'investigating',
    'commented', 'resolved', 'ignored', 'regressed', 'severity_changed', 'linked_execution'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS error_issue_activity_issue_occurred_idx
  ON error_issue_activity (issue_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY,
  incident_key text NOT NULL UNIQUE CHECK (incident_key ~ '^INC_[A-Z0-9]{8,}$'),
  title text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'resolved')),
  declared_by_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  declared_at timestamptz NOT NULL DEFAULT now(),
  mitigated_at timestamptz,
  resolved_at timestamptz,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS incident_issues (
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  issue_id uuid NOT NULL REFERENCES error_issues(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  PRIMARY KEY (incident_id, issue_id)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY,
  rule_name text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  source text,
  minimum_severity text NOT NULL CHECK (minimum_severity IN ('critical', 'high', 'medium', 'low')),
  error_code text,
  notification_channel text NOT NULL CHECK (notification_channel IN ('zalo', 'email')),
  destination_reference text NOT NULL,
  dedup_window_seconds integer NOT NULL DEFAULT 300 CHECK (dedup_window_seconds BETWEEN 60 AND 86400),
  escalation_after_seconds integer CHECK (escalation_after_seconds BETWEEN 60 AND 86400),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id uuid PRIMARY KEY,
  issue_id uuid NOT NULL REFERENCES error_issues(id) ON DELETE RESTRICT,
  alert_rule_id uuid REFERENCES alert_rules(id) ON DELETE RESTRICT,
  delivery_kind text NOT NULL CHECK (delivery_kind IN ('new', 'digest', 'escalation', 'resolved', 'regressed')),
  notification_channel text NOT NULL CHECK (notification_channel IN ('zalo', 'email')),
  dedup_key text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  failed_at timestamptz,
  provider_message_id text,
  failure_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS alert_deliveries_issue_requested_idx
  ON alert_deliveries (issue_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS source_map_objects (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE,
  sha256 char(64) NOT NULL,
  storage_provider text NOT NULL CHECK (storage_provider IN ('ops_object_store')),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ingest_dead_letters (
  id uuid PRIMARY KEY,
  envelope_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  failure_code text NOT NULL,
  failure_detail text,
  payload jsonb NOT NULL,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  resolved_at timestamptz,
  resolution_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ingest_dead_letters_open_idx
  ON ingest_dead_letters (received_at DESC)
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION ensure_error_operations_partitions()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  month_start date;
  month_end date;
  partition_suffix text;
  offset_month integer;
BEGIN
  FOR offset_month IN 0..1 LOOP
    month_start := (date_trunc('month', clock_timestamp()) + make_interval(months => offset_month))::date;
    month_end := (month_start + INTERVAL '1 month')::date;
    partition_suffix := to_char(month_start, 'YYYYMM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF ingest_envelopes FOR VALUES FROM (%L) TO (%L)',
      'ingest_envelopes_' || partition_suffix,
      month_start,
      month_end
    );
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF error_events FOR VALUES FROM (%L) TO (%L)',
      'error_events_' || partition_suffix,
      month_start,
      month_end
    );
  END LOOP;
END;
$$;

SELECT ensure_error_operations_partitions();

CREATE OR REPLACE FUNCTION reject_error_operations_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Error Operations raw records are append-only';
END;
$$;

CREATE TRIGGER ingest_envelopes_append_only
  BEFORE UPDATE OR DELETE ON ingest_envelopes
  FOR EACH ROW EXECUTE FUNCTION reject_error_operations_mutation();

CREATE TRIGGER error_events_append_only
  BEFORE UPDATE OR DELETE ON error_events
  FOR EACH ROW EXECUTE FUNCTION reject_error_operations_mutation();

CREATE TRIGGER ingest_idempotency_append_only
  BEFORE UPDATE OR DELETE ON ingest_idempotency
  FOR EACH ROW EXECUTE FUNCTION reject_error_operations_mutation();

REVOKE UPDATE, DELETE ON ingest_envelopes, error_events FROM PUBLIC;
REVOKE UPDATE, DELETE ON ingest_idempotency FROM PUBLIC;
