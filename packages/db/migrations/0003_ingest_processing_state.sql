ALTER TABLE ingest_envelopes
  ADD COLUMN IF NOT EXISTS redacted boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS ingest_processing (
  envelope_id uuid NOT NULL,
  envelope_received_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'processed', 'retrying', 'dead_lettered')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  claimed_by text,
  processed_at timestamptz,
  last_error_code text,
  last_error_detail text,
  PRIMARY KEY (envelope_id, envelope_received_at),
  FOREIGN KEY (envelope_id, envelope_received_at)
    REFERENCES ingest_envelopes (id, received_at) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ingest_processing_ready_idx
  ON ingest_processing (state, next_attempt_at, received_at);
