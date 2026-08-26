CREATE TABLE IF NOT EXISTS release_publishers (
  key_id text PRIMARY KEY CHECK (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$'),
  service_name text NOT NULL CHECK (service_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  secret_reference text NOT NULL CHECK (char_length(secret_reference) BETWEEN 3 AND 512),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'rotated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  rotated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE source_map_objects
  ADD COLUMN IF NOT EXISTS generated_file text;

UPDATE source_map_objects
SET generated_file = COALESCE(
  NULLIF(metadata ->> 'generatedFile', ''),
  'legacy-' || id::text
)
WHERE generated_file IS NULL;

ALTER TABLE source_map_objects
  ALTER COLUMN generated_file SET NOT NULL;

ALTER TABLE source_map_objects
  ADD CONSTRAINT source_map_objects_generated_file_check
  CHECK (generated_file ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$');

ALTER TABLE source_map_objects
  ADD CONSTRAINT source_map_objects_release_generated_file_key
  UNIQUE (release_id, generated_file);

REVOKE UPDATE, DELETE ON release_publishers, source_map_objects FROM PUBLIC;
