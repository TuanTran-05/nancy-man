DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ingest_clients
    WHERE public_key_id = 'edutrack-ops-runtime'
      AND client_name <> 'edutrack-ops-runtime-ingest'
  ) THEN
    RAISE EXCEPTION 'OPS_TELEMETRY_INGEST_CLIENT_KEY_CONFLICT';
  END IF;
END $$;

INSERT INTO ingest_clients (
  id,
  client_name,
  client_kind,
  service_name,
  status,
  public_key_id,
  secret_reference,
  allowed_origins,
  metadata
) VALUES (
  'c54d5952-f5d6-47b2-a2de-959d6012d5ee',
  'edutrack-ops-runtime-ingest',
  'server',
  'edutrack-ops',
  'active',
  'edutrack-ops-runtime',
  'ops-telemetry-hmac',
  '[]'::jsonb,
  '{"managedBy":"ops-runtime-telemetry-migration"}'::jsonb
)
ON CONFLICT (client_name) DO UPDATE
SET
  client_kind = EXCLUDED.client_kind,
  service_name = EXCLUDED.service_name,
  status = EXCLUDED.status,
  public_key_id = EXCLUDED.public_key_id,
  secret_reference = EXCLUDED.secret_reference,
  allowed_origins = EXCLUDED.allowed_origins,
  disabled_at = NULL,
  rotated_at = NULL,
  metadata = EXCLUDED.metadata;
