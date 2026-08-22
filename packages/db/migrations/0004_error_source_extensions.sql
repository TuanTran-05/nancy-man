ALTER TABLE ingest_envelopes
  DROP CONSTRAINT IF EXISTS ingest_envelopes_source_check;

ALTER TABLE ingest_envelopes
  ADD CONSTRAINT ingest_envelopes_source_check
  CHECK (source IN (
    'browser', 'api', 'database', 'document_store', 'job', 'provider', 'process', 'deployment', 'synthetic'
  ));

ALTER TABLE error_events
  DROP CONSTRAINT IF EXISTS error_events_source_check;

ALTER TABLE error_events
  ADD CONSTRAINT error_events_source_check
  CHECK (source IN (
    'browser', 'api', 'database', 'document_store', 'job', 'provider', 'process', 'deployment', 'synthetic'
  ));
