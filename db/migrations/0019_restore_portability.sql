-- 0019_restore_portability.sql
-- Make custom-format pg_dump restores independent of the restore session's search_path.

BEGIN;

CREATE OR REPLACE FUNCTION app_normalize_text(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT upper(
    btrim(
      regexp_replace(
        public.unaccent('public.unaccent'::regdictionary, coalesce(value, '')),
        '\s+', ' ', 'g'
      )
    )
  );
$$;

COMMENT ON FUNCTION app_normalize_text(TEXT) IS
  'Vietnamese-insensitive normalization with schema-qualified unaccent objects so pg_dump restores work under an empty search_path.';

COMMIT;
