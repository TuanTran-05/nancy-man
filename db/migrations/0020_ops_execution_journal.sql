-- 0020_ops_execution_journal.sql
--
-- Protected evidence for Ops DML. This migration is deliberately run only by
-- the deployment principal after deploy/postgres/002_ops_mutation_roles.sql
-- has provisioned the dedicated NOLOGIN roles and granted ops_journal_owner
-- TRIGGER only on the explicitly reviewed application tables below.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_journal_owner') THEN
    RAISE EXCEPTION 'ops_journal_owner must be provisioned before 0020';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_dml') THEN
    RAISE EXCEPTION 'ops_dml must be provisioned before 0020';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_ddl') THEN
    RAISE EXCEPTION 'ops_ddl must be provisioned before 0020';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'pgcrypto must be available for row-journal digests';
  END IF;

  IF NOT pg_has_role(session_user, 'ops_journal_owner', 'member') THEN
    RAISE EXCEPTION
      'migration session user % must be a member of ops_journal_owner',
      session_user;
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS _ops AUTHORIZATION ops_journal_owner;
ALTER SCHEMA _ops OWNER TO ops_journal_owner;

SET LOCAL ROLE ops_journal_owner;

CREATE TABLE IF NOT EXISTS _ops.execution_registry (
  execution_id uuid PRIMARY KEY,
  execution_key text NOT NULL UNIQUE CHECK (char_length(execution_key) BETWEEN 12 AND 200),
  actor_user_id text NOT NULL CHECK (char_length(actor_user_id) BETWEEN 1 AND 200),
  actor_session_id text NOT NULL CHECK (char_length(actor_session_id) BETWEEN 1 AND 200),
  operation_kind text NOT NULL CHECK (operation_kind = 'DML'),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  sql_fingerprint text NOT NULL CHECK (char_length(sql_fingerprint) BETWEEN 16 AND 200),
  started_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS _ops.journaled_tables (
  table_oid oid PRIMARY KEY,
  schema_name name NOT NULL,
  table_name name NOT NULL,
  primary_key_columns text[] NOT NULL CHECK (cardinality(primary_key_columns) > 0),
  enabled boolean NOT NULL DEFAULT true,
  row_size_limit_bytes integer NOT NULL DEFAULT 262144 CHECK (row_size_limit_bytes BETWEEN 1024 AND 1048576),
  post_check_policy text NOT NULL DEFAULT 'generic' CHECK (post_check_policy ~ '^[a-z][a-z0-9_]{0,62}$'),
  recovery_class text NOT NULL DEFAULT 'REVERSIBLE'
    CHECK (recovery_class IN ('REVERSIBLE', 'PITR_ONLY', 'NO_AUTOMATIC_UNDO')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schema_name, table_name)
);

CREATE TABLE IF NOT EXISTS _ops.journal_exclusions (
  table_oid oid PRIMARY KEY,
  schema_name name NOT NULL,
  table_name name NOT NULL,
  recovery_class text NOT NULL CHECK (recovery_class IN ('PITR_ONLY', 'NO_AUTOMATIC_UNDO')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schema_name, table_name)
);

CREATE TABLE IF NOT EXISTS _ops.row_change_journal (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES _ops.execution_registry(execution_id) ON DELETE RESTRICT,
  statement_index integer NOT NULL CHECK (statement_index >= 0),
  actor_user_id text NOT NULL,
  actor_session_id text NOT NULL,
  schema_name name NOT NULL,
  table_name name NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  primary_key jsonb NOT NULL,
  before_row jsonb,
  after_row jsonb,
  before_hash bytea,
  after_hash bytea,
  transaction_id bigint NOT NULL,
  wal_lsn pg_lsn NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (operation = 'INSERT' AND before_row IS NULL AND after_row IS NOT NULL AND before_hash IS NULL AND after_hash IS NOT NULL)
    OR (operation = 'UPDATE' AND before_row IS NOT NULL AND after_row IS NOT NULL AND before_hash IS NOT NULL AND after_hash IS NOT NULL)
    OR (operation = 'DELETE' AND before_row IS NOT NULL AND after_row IS NULL AND before_hash IS NOT NULL AND after_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS row_change_journal_execution_sequence_idx
  ON _ops.row_change_journal (execution_id, sequence);

CREATE OR REPLACE FUNCTION _ops.register_journaled_table(
  relation_oid regclass,
  requested_row_size_limit_bytes integer DEFAULT 262144,
  requested_post_check_policy text DEFAULT 'generic',
  requested_recovery_class text DEFAULT 'REVERSIBLE'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, _ops
AS $function$
DECLARE
  relation_schema name;
  relation_name name;
  relation_kind "char";
  primary_key_columns text[];
BEGIN
  SELECT namespace.nspname, class.relname, class.relkind
    INTO relation_schema, relation_name, relation_kind
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE class.oid = relation_oid;

  IF NOT FOUND OR relation_kind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'Only physical tables may be registered for row journaling: %', relation_oid;
  END IF;

  IF relation_schema IN ('_ops', 'pg_catalog', 'information_schema') OR relation_schema LIKE 'pg\_%' THEN
    RAISE EXCEPTION 'System and _ops relations are not journalable: %', relation_oid;
  END IF;

  IF NOT has_table_privilege('ops_journal_owner', relation_oid, 'TRIGGER') THEN
    RAISE EXCEPTION
      'ops_journal_owner requires TRIGGER privilege before registering %',
      relation_oid;
  END IF;

  SELECT array_agg(attribute.attname ORDER BY key_position.ordinality)
    INTO primary_key_columns
    FROM pg_index AS index_definition
    CROSS JOIN unnest(index_definition.indkey) WITH ORDINALITY AS key_position(attnum, ordinality)
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_definition.indrelid
     AND attribute.attnum = key_position.attnum
   WHERE index_definition.indrelid = relation_oid
     AND index_definition.indisprimary;

  IF primary_key_columns IS NULL OR cardinality(primary_key_columns) = 0 THEN
    RAISE EXCEPTION 'A journaled table requires an ordered primary key: %', relation_oid;
  END IF;

  IF requested_row_size_limit_bytes NOT BETWEEN 1024 AND 1048576 THEN
    RAISE EXCEPTION 'row size limit must be between 1024 and 1048576 bytes';
  END IF;

  IF requested_post_check_policy !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'post-check policy must be a lower-case identifier';
  END IF;

  IF requested_recovery_class <> 'REVERSIBLE' THEN
    RAISE EXCEPTION 'ordinary DML registration must be REVERSIBLE, not %', requested_recovery_class;
  END IF;

  INSERT INTO _ops.journaled_tables (
    table_oid,
    schema_name,
    table_name,
    primary_key_columns,
    row_size_limit_bytes,
    post_check_policy,
    recovery_class
  ) VALUES (
    relation_oid,
    relation_schema,
    relation_name,
    primary_key_columns,
    requested_row_size_limit_bytes,
    requested_post_check_policy,
    requested_recovery_class
  )
  ON CONFLICT (table_oid) DO UPDATE
    SET primary_key_columns = EXCLUDED.primary_key_columns,
        enabled = true,
        row_size_limit_bytes = EXCLUDED.row_size_limit_bytes,
        post_check_policy = EXCLUDED.post_check_policy,
        recovery_class = EXCLUDED.recovery_class;

  EXECUTE format('DROP TRIGGER IF EXISTS ops_capture_row_change ON %I.%I', relation_schema, relation_name);
  EXECUTE format(
    'CREATE TRIGGER ops_capture_row_change AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION _ops.capture_row_change()',
    relation_schema,
    relation_name
  );
END
$function$;

CREATE OR REPLACE FUNCTION _ops.begin_dml_execution(
  requested_execution_id uuid,
  requested_execution_key text,
  requested_reason text,
  requested_sql_fingerprint text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, _ops
AS $function$
DECLARE
  configured_execution_id text := current_setting('ops.execution_id', true);
  configured_actor_user_id text := current_setting('ops.actor_user_id', true);
  configured_actor_session_id text := current_setting('ops.actor_session_id', true);
BEGIN
  IF NOT pg_has_role(session_user, 'ops_dml', 'member') THEN
    RAISE EXCEPTION 'Only the Ops DML identity may begin a journaled execution';
  END IF;

  IF configured_execution_id IS NULL OR configured_execution_id = ''
    OR configured_actor_user_id IS NULL OR configured_actor_user_id = ''
    OR configured_actor_session_id IS NULL OR configured_actor_session_id = '' THEN
    RAISE EXCEPTION 'ops.execution_id, ops.actor_user_id, and ops.actor_session_id are required';
  END IF;

  IF configured_execution_id::uuid <> requested_execution_id THEN
    RAISE EXCEPTION 'requested execution ID does not match the transaction context';
  END IF;

  INSERT INTO _ops.execution_registry (
    execution_id,
    execution_key,
    actor_user_id,
    actor_session_id,
    operation_kind,
    reason,
    sql_fingerprint
  ) VALUES (
    requested_execution_id,
    requested_execution_key,
    configured_actor_user_id,
    configured_actor_session_id,
    'DML',
    requested_reason,
    requested_sql_fingerprint
  );
END
$function$;

CREATE OR REPLACE FUNCTION _ops.capture_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, _ops
AS $function$
DECLARE
  configured_execution_id text := current_setting('ops.execution_id', true);
  configured_actor_user_id text := current_setting('ops.actor_user_id', true);
  configured_actor_session_id text := current_setting('ops.actor_session_id', true);
  configured_statement_index text := current_setting('ops.statement_index', true);
  execution_uuid uuid;
  statement_number integer;
  registered_table _ops.journaled_tables%ROWTYPE;
  registered_execution _ops.execution_registry%ROWTYPE;
  before_document jsonb;
  after_document jsonb;
  row_document jsonb;
  key_document jsonb;
BEGIN
  -- Normal application writes must keep working without Ops telemetry. The
  -- restricted ops_dml identity, however, may never mutate a journaled table
  -- without an execution/actor/statement context.
  IF NOT pg_has_role(session_user, 'ops_dml', 'member') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF configured_execution_id IS NULL OR configured_execution_id = ''
    OR configured_actor_user_id IS NULL OR configured_actor_user_id = ''
    OR configured_actor_session_id IS NULL OR configured_actor_session_id = ''
    OR configured_statement_index IS NULL OR configured_statement_index = '' THEN
    RAISE EXCEPTION
      'ops.execution_id, ops.actor_user_id, ops.actor_session_id, and ops.statement_index are required';
  END IF;

  BEGIN
    execution_uuid := configured_execution_id::uuid;
    statement_number := configured_statement_index::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Ops execution context has an invalid UUID or statement index';
  END;

  IF statement_number < 0 THEN
    RAISE EXCEPTION 'ops.statement_index must be non-negative';
  END IF;

  SELECT *
    INTO registered_table
    FROM _ops.journaled_tables
   WHERE table_oid = TG_RELID
     AND enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No enabled journal policy exists for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  SELECT *
    INTO registered_execution
    FROM _ops.execution_registry
   WHERE execution_id = execution_uuid;
  IF NOT FOUND
    OR registered_execution.actor_user_id <> configured_actor_user_id
    OR registered_execution.actor_session_id <> configured_actor_session_id
    OR registered_execution.operation_kind <> 'DML' THEN
    RAISE EXCEPTION 'The Ops execution registry does not match the transaction context';
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

  IF octet_length(convert_to(coalesce(before_document::text, ''), 'UTF8')) > registered_table.row_size_limit_bytes
    OR octet_length(convert_to(coalesce(after_document::text, ''), 'UTF8')) > registered_table.row_size_limit_bytes THEN
    RAISE EXCEPTION 'Row for %.% exceeds the configured journal size limit', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  SELECT coalesce(
    jsonb_object_agg(key_column.column_name, row_document -> key_column.column_name ORDER BY key_column.ordinality),
    '{}'::jsonb
  )
    INTO key_document
    FROM unnest(registered_table.primary_key_columns) WITH ORDINALITY AS key_column(column_name, ordinality);

  INSERT INTO _ops.row_change_journal (
    execution_id,
    statement_index,
    actor_user_id,
    actor_session_id,
    schema_name,
    table_name,
    operation,
    primary_key,
    before_row,
    after_row,
    before_hash,
    after_hash,
    transaction_id,
    wal_lsn
  ) VALUES (
    execution_uuid,
    statement_number,
    configured_actor_user_id,
    configured_actor_session_id,
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    TG_OP,
    key_document,
    before_document,
    after_document,
    CASE WHEN before_document IS NULL THEN NULL ELSE public.digest(convert_to(before_document::text, 'UTF8'), 'sha256') END,
    CASE WHEN after_document IS NULL THEN NULL ELSE public.digest(convert_to(after_document::text, 'UTF8'), 'sha256') END,
    txid_current(),
    pg_current_wal_lsn()
  );

  RETURN COALESCE(NEW, OLD);
END
$function$;

ALTER FUNCTION _ops.register_journaled_table(regclass, integer, text, text) OWNER TO ops_journal_owner;
ALTER FUNCTION _ops.begin_dml_execution(uuid, text, text, text) OWNER TO ops_journal_owner;
ALTER FUNCTION _ops.capture_row_change() OWNER TO ops_journal_owner;

-- These are the initially reviewed mutable business tables. Every other
-- physical public table is written into journal_exclusions below so its DML
-- cannot be incorrectly treated as automatically reversible.
DO $register_initial$
DECLARE
  target_relation regclass;
BEGIN
  FOREACH target_relation IN ARRAY ARRAY[
    'public.students'::regclass,
    'public.classes'::regclass,
    'public.class_terms'::regclass,
    'public.student_course_enrollments'::regclass,
    'public.student_leave_periods'::regclass,
    'public.attendance'::regclass,
    'public.course_fee_ledgers'::regclass,
    'public.student_wallets'::regclass,
    'public.receipts'::regclass,
    'public.receipt_allocations'::regclass,
    'public.wallet_transactions'::regclass,
    'public.invoices'::regclass,
    'public.invoice_line_items'::regclass,
    'public.refunds'::regclass,
    'public.expenses'::regclass
  ]
  LOOP
    PERFORM _ops.register_journaled_table(target_relation);
  END LOOP;
END
$register_initial$;

INSERT INTO _ops.journal_exclusions (table_oid, schema_name, table_name, recovery_class, reason)
SELECT class.oid, namespace.nspname, class.relname, exclusions.recovery_class, exclusions.reason
  FROM (VALUES
    ('audit_logs', 'PITR_ONLY', 'append-only audit evidence'),
    ('admissions_history', 'PITR_ONLY', 'append-only admission history'),
    ('student_progression_events', 'PITR_ONLY', 'append-only progression history'),
    ('student_enrollment_migration_journal', 'PITR_ONLY', 'migration evidence'),
    ('webhook_events', 'PITR_ONLY', 'provider payload and idempotency evidence'),
    ('finance_idempotency_keys', 'PITR_ONLY', 'payment idempotency state'),
    ('payment_order_codes', 'PITR_ONLY', 'payment provider allocation state'),
    ('ledger_notice_log', 'PITR_ONLY', 'externally delivered notice evidence'),
    ('outbox_jobs', 'NO_AUTOMATIC_UNDO', 'may cause external side effects'),
    ('jobs', 'NO_AUTOMATIC_UNDO', 'background work control state'),
    ('job_runs', 'NO_AUTOMATIC_UNDO', 'background work evidence'),
    ('notifications', 'NO_AUTOMATIC_UNDO', 'may cause user-visible notifications'),
    ('admin_notifications', 'NO_AUTOMATIC_UNDO', 'may cause staff notifications'),
    ('admin_notification_failures', 'PITR_ONLY', 'notification failure evidence'),
    ('zalo_notifications', 'NO_AUTOMATIC_UNDO', 'external Zalo delivery state'),
    ('zalo_bulk_jobs', 'NO_AUTOMATIC_UNDO', 'external Zalo delivery state'),
    ('zalo_bulk_job_items', 'NO_AUTOMATIC_UNDO', 'external Zalo delivery state'),
    ('zalo_bot_messages', 'NO_AUTOMATIC_UNDO', 'external bot conversation state'),
    ('zalo_bot_chat_claims', 'PITR_ONLY', 'authentication claim state'),
    ('zalo_bot_chat_sessions', 'PITR_ONLY', 'authentication session state'),
    ('zalo_bot_link_codes', 'PITR_ONLY', 'authentication code state'),
    ('student_auth_credentials', 'PITR_ONLY', 'credential material must not enter row journal'),
    ('password_reset_requests', 'PITR_ONLY', 'credential recovery state'),
    ('staff_password_reset_requests', 'PITR_ONLY', 'credential recovery state'),
    ('schema_migrations', 'PITR_ONLY', 'schema migration control plane')
  ) AS exclusions(table_name, recovery_class, reason)
  JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
  JOIN pg_class AS class
    ON class.relnamespace = namespace.oid
   AND class.relname = exclusions.table_name
ON CONFLICT (table_oid) DO UPDATE
  SET recovery_class = EXCLUDED.recovery_class,
      reason = EXCLUDED.reason;

INSERT INTO _ops.journal_exclusions (table_oid, schema_name, table_name, recovery_class, reason)
SELECT class.oid, namespace.nspname, class.relname, 'PITR_ONLY', 'no primary key; row-level reverse cannot be proved'
  FROM pg_class AS class
  JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
 WHERE namespace.nspname = 'public'
   AND class.relkind IN ('r', 'p')
   AND NOT EXISTS (
     SELECT 1
       FROM pg_index AS index_definition
      WHERE index_definition.indrelid = class.oid
        AND index_definition.indisprimary
   )
ON CONFLICT (table_oid) DO NOTHING;

INSERT INTO _ops.journal_exclusions (table_oid, schema_name, table_name, recovery_class, reason)
SELECT class.oid, namespace.nspname, class.relname, 'PITR_ONLY', 'not registered until a table-specific recovery review is complete'
  FROM pg_class AS class
  JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
 WHERE namespace.nspname = 'public'
   AND class.relkind IN ('r', 'p')
   AND NOT EXISTS (SELECT 1 FROM _ops.journaled_tables WHERE table_oid = class.oid)
ON CONFLICT (table_oid) DO NOTHING;

REVOKE ALL ON SCHEMA _ops FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM PUBLIC, ops_dml, ops_ddl;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM PUBLIC, ops_dml, ops_ddl;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM PUBLIC, ops_dml, ops_ddl;
GRANT USAGE ON SCHEMA _ops TO ops_dml;
GRANT EXECUTE ON FUNCTION _ops.begin_dml_execution(uuid, text, text, text) TO ops_dml;

RESET ROLE;
COMMIT;
