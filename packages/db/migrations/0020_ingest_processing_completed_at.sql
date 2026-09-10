ALTER TABLE ingest_processing
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN ingest_processing.completed_at IS
  'Terminal completion time for processed or dead-lettered envelopes.';
