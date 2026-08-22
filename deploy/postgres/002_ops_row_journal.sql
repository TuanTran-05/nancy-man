\set ON_ERROR_STOP on

\if :{?ops_business_schemas}
\else
  \echo 'ops_business_schemas is required'
  \quit
\endif
\if :{?ops_schema_owner_role}
\else
  \echo 'ops_schema_owner_role is required'
  \quit
\endif

BEGIN;

DO $preflight$
DECLARE
  schema_owner text := :'ops_schema_owner_role';
  schema_name text;
BEGIN
  IF schema_owner !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'ops_schema_owner_role must be a lower-case PostgreSQL identifier';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = schema_owner) THEN
    RAISE EXCEPTION 'ops_schema_owner_role % does not exist', schema_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_readonly') THEN
    RAISE EXCEPTION 'ops_readonly must be installed before the row journal';
  END IF;

  FOREACH schema_name IN ARRAY string_to_array(:'ops_business_schemas', ',') LOOP
    schema_name := btrim(schema_name);
    IF schema_name !~ '^[a-z][a-z0-9_]{0,62}$' THEN
      RAISE EXCEPTION 'Business schema names must be lower-case PostgreSQL identifiers';
    END IF;
    IF schema_name IN ('_ops', 'pg_catalog', 'information_schema') THEN
      RAISE EXCEPTION 'Business schema % is not eligible for row journal triggers', schema_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name) THEN
      RAISE EXCEPTION 'Business schema % does not exist', schema_name;
    END IF;
  END LOOP;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS _ops AUTHORIZATION :"ops_schema_owner_role";
ALTER SCHEMA _ops OWNER TO :"ops_schema_owner_role";

CREATE TABLE IF NOT EXISTS _ops.execution_registry (
  execution_id uuid PRIMARY KEY,
  execution_key text NOT NULL UNIQUE,
  actor_user_id text NOT NULL,
  actor_session_id text NOT NULL,
  operation_kind text NOT NULL CHECK (operation_kind IN ('dml', 'ddl', 'recovery')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  started_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS _ops.row_change_journal (
  journal_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES _ops.execution_registry(execution_id) ON DELETE RESTRICT,
  schema_name name NOT NULL,
  table_name name NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  primary_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_row jsonb,
  after_row jsonb,
  transaction_id bigint NOT NULL,
  wal_lsn pg_lsn NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (operation = 'INSERT' AND before_row IS NULL AND after_row IS NOT NULL)
    OR (operation = 'UPDATE' AND before_row IS NOT NULL AND after_row IS NOT NULL)
    OR (operation = 'DELETE' AND before_row IS NOT NULL AND after_row IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS row_change_journal_execution_order_idx
  ON _ops.row_change_journal (execution_id, journal_id DESC);

CREATE OR REPLACE FUNCTION _ops.capture_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, _ops
AS $function$
DECLARE
  execution_setting text := current_setting('app.ops_execution_id', true);
  execution_uuid uuid;
  before_document jsonb;
  after_document jsonb;
  row_document jsonb;
  key_document jsonb := '{}'::jsonb;
  key_column record;
BEGIN
  IF execution_setting IS NULL OR execution_setting = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    execution_uuid := execution_setting::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'app.ops_execution_id must be a UUID';
  END;

  PERFORM 1
  FROM _ops.execution_registry
  WHERE execution_id = execution_uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ops execution registry is missing for %', execution_uuid
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    before_document := NULL;
    after_document := to_jsonb(NEW);
    row_document := after_document;
  ELSIF TG_OP = 'UPDATE' THEN
    before_document := to_jsonb(OLD);
    after_document := to_jsonb(NEW);
    row_document := after_document;
  ELSIF TG_OP = 'DELETE' THEN
    before_document := to_jsonb(OLD);
    after_document := NULL;
    row_document := before_document;
  ELSE
    RAISE EXCEPTION 'Unexpected row journal operation %', TG_OP;
  END IF;

  FOR key_column IN
    SELECT attribute.attname
    FROM pg_index AS index_definition
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_definition.indrelid
      AND attribute.attnum = ANY(index_definition.indkey)
    WHERE index_definition.indrelid = TG_RELID
      AND index_definition.indisprimary
    ORDER BY array_position(index_definition.indkey, attribute.attnum)
  LOOP
    key_document := key_document || jsonb_build_object(
      key_column.attname,
      row_document -> key_column.attname
    );
  END LOOP;

  INSERT INTO _ops.row_change_journal (
    execution_id,
    schema_name,
    table_name,
    operation,
    primary_key,
    before_row,
    after_row,
    transaction_id,
    wal_lsn
  ) VALUES (
    execution_uuid,
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    TG_OP,
    key_document,
    before_document,
    after_document,
    txid_current(),
    pg_current_wal_lsn()
  );

  RETURN COALESCE(NEW, OLD);
END
$function$;

ALTER FUNCTION _ops.capture_row_change() OWNER TO :"ops_schema_owner_role";
REVOKE ALL ON SCHEMA _ops FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM PUBLIC, ops_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM PUBLIC, ops_readonly;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM PUBLIC, ops_readonly;

DO $triggers$
DECLARE
  schema_name text;
  relation record;
BEGIN
  FOREACH schema_name IN ARRAY string_to_array(:'ops_business_schemas', ',') LOOP
    schema_name := btrim(schema_name);
    FOR relation IN
      SELECT namespace.nspname AS schema_name, class.relname AS table_name
      FROM pg_class AS class
      JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = schema_name
        AND namespace.nspname <> '_ops'
        AND class.relkind IN ('r', 'p')
    LOOP
      EXECUTE format(
        'DROP TRIGGER IF EXISTS ops_capture_row_change ON %I.%I',
        relation.schema_name,
        relation.table_name
      );
      EXECUTE format(
        'CREATE TRIGGER ops_capture_row_change AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION _ops.capture_row_change()',
        relation.schema_name,
        relation.table_name
      );
    END LOOP;
  END LOOP;
END
$triggers$;

COMMIT;
