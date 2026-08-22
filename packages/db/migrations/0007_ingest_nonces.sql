CREATE TABLE IF NOT EXISTS ingest_nonces (
  nonce_hash char(64) PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_nonces_expires_at_idx
  ON ingest_nonces (expires_at);
