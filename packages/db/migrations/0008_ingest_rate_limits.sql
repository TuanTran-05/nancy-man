CREATE TABLE IF NOT EXISTS ingest_rate_limits (
  window_started_at timestamptz NOT NULL,
  ingest_client_id uuid NOT NULL REFERENCES ingest_clients(id) ON DELETE RESTRICT,
  dimension text NOT NULL CHECK (dimension IN ('ip', 'session', 'fingerprint')),
  value_hash char(64) NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count BETWEEN 1 AND 100000),
  PRIMARY KEY (window_started_at, ingest_client_id, dimension, value_hash)
);

CREATE INDEX IF NOT EXISTS ingest_rate_limits_window_idx
  ON ingest_rate_limits (window_started_at);
