DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ingest_clients
    WHERE public_key_id IN (
      'edutrack-platform-runtime',
      'edutrack-platform-browser',
      'ops-web-public-key',
      'thienuy-public'
    )
      AND client_name NOT IN (
        'edutrack-platform-runtime-ingest',
        'edutrack-platform-browser-ingest',
        'edutrack-ops-web-browser-ingest',
        'thienuy-public-browser-ingest'
      )
  ) THEN
    RAISE EXCEPTION 'TELEMETRY_INGEST_CLIENT_KEY_CONFLICT';
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
  '0d2db1fb-b97f-4b9b-bf2d-7b79a18238f0',
  'edutrack-platform-runtime-ingest',
  'server',
  'edutrack-platform',
  'active',
  'edutrack-platform-runtime',
  'ops-telemetry-hmac',
  '[]'::jsonb,
  '{"managedBy":"telemetry-source-client-migration","source":"platform"}'::jsonb
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
) VALUES
  (
    '1f5d70d8-09a3-4b14-9d37-92c78c18c2c2',
    'edutrack-platform-browser-ingest',
    'browser',
    'edutrack-platform-browser',
    'active',
    'edutrack-platform-browser',
    NULL,
    '["https://vps.thienuy.edu.vn", "https://esp.thienuy.edu.vn"]'::jsonb,
    '{"managedBy":"telemetry-source-client-migration","surfaces":["staff","esp"]}'::jsonb
  ),
  (
    '2d8a5727-6f0b-4a18-a5f0-bf202b73c2c8',
    'edutrack-ops-web-browser-ingest',
    'browser',
    'edutrack-ops-web-browser',
    'active',
    'ops-web-public-key',
    NULL,
    '["https://man.thienuy.edu.vn"]'::jsonb,
    '{"managedBy":"telemetry-source-client-migration","surfaces":["ops-web"]}'::jsonb
  ),
  (
    '3f0f9870-8f6a-4b09-9d5f-f0d8a7cf80d8',
    'thienuy-public-browser-ingest',
    'browser',
    'thienuy-public',
    'active',
    'thienuy-public',
    NULL,
    '["https://thienuy.edu.vn"]'::jsonb,
    '{"managedBy":"telemetry-source-client-migration","surfaces":["public-website"]}'::jsonb
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
