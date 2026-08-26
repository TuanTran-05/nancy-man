\set ON_ERROR_STOP on

\if :{?app_schema_owner_role}
\else
  \echo 'app_schema_owner_role is required'
  \quit
\endif
\if :{?ops_migration_role}
\else
  \echo 'ops_migration_role is required'
  \quit
\endif
\if :{?ops_dml_login_role}
\else
  \echo 'ops_dml_login_role is required'
  \quit
\endif
\if :{?ops_ddl_login_role}
\else
  \echo 'ops_ddl_login_role is required'
  \quit
\endif
\if :{?ops_breakglass_login_role}
\else
  \echo 'ops_breakglass_login_role is required'
  \quit
\endif

BEGIN;

DO $roles$
DECLARE
  app_owner text := :'app_schema_owner_role';
  migration_role text := :'ops_migration_role';
  dml_login_role text := :'ops_dml_login_role';
  ddl_login_role text := :'ops_ddl_login_role';
  breakglass_login_role text := :'ops_breakglass_login_role';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_owner) THEN
    RAISE EXCEPTION 'application schema owner role % does not exist', app_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = migration_role) THEN
    RAISE EXCEPTION 'ops migration role % does not exist', migration_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = dml_login_role AND rolcanlogin) THEN
    RAISE EXCEPTION 'ops DML login role % must exist and be able to login', dml_login_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ddl_login_role AND rolcanlogin) THEN
    RAISE EXCEPTION 'ops DDL login role % must exist and be able to login', ddl_login_role;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = breakglass_login_role
       AND rolcanlogin
       AND rolsuper
  ) THEN
    RAISE EXCEPTION
      'ops break-glass login role % must be a separately provisioned sealed superuser',
      breakglass_login_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_journal_owner') THEN
    EXECUTE 'CREATE ROLE ops_journal_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_dml') THEN
    EXECUTE 'CREATE ROLE ops_dml NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_ddl') THEN
    EXECUTE 'CREATE ROLE ops_ddl NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;

  EXECUTE 'ALTER ROLE ops_journal_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  EXECUTE 'ALTER ROLE ops_dml NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  EXECUTE 'ALTER ROLE ops_ddl NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';

  EXECUTE format('GRANT ops_journal_owner TO %I', migration_role);
  EXECUTE format('GRANT ops_dml TO %I', migration_role);
  EXECUTE format('GRANT ops_ddl TO %I', migration_role);
  EXECUTE format('GRANT ops_dml TO %I', dml_login_role);
  EXECUTE format('GRANT ops_ddl TO %I', ddl_login_role);

  -- DDL is disabled by default. Membership of the application owner would let
  -- this role disable a journal trigger, so it is intentionally deferred to
  -- the dedicated DDL/break-glass phase after event-trigger safeguards exist.
  EXECUTE format('REVOKE ops_journal_owner, ops_dml, ops_ddl FROM %I', app_owner);
END
$roles$;

-- This is the narrow capability required for the dedicated journal owner to
-- attach its trigger during the controlled migration. It grants neither DML,
-- schema ownership, nor access to _ops tables.
GRANT TRIGGER ON ALL TABLES IN SCHEMA public TO ops_journal_owner;

-- The migration creates _ops after the first bootstrap invocation. Re-run this
-- artifact immediately after that migration to grant DML only on registered
-- tables and only the sequences owned by their primary application columns.
DO $registered_grants$
DECLARE
  relation record;
  sequence_relation record;
BEGIN
  IF to_regclass('_ops.journaled_tables') IS NULL THEN
    RAISE NOTICE 'Journal schema is not installed yet; role bootstrap is complete.';
    RETURN;
  END IF;

  FOR relation IN
    SELECT schema_name, table_name
      FROM _ops.journaled_tables
     WHERE enabled
  LOOP
    EXECUTE format(
      'GRANT INSERT, UPDATE, DELETE ON TABLE %I.%I TO ops_dml',
      relation.schema_name,
      relation.table_name
    );
  END LOOP;

  FOR sequence_relation IN
    SELECT DISTINCT sequence_namespace.nspname AS schema_name, sequence_class.relname AS sequence_name
      FROM _ops.journaled_tables AS journaled
      JOIN pg_class AS table_class ON table_class.oid = journaled.table_oid
      JOIN pg_attribute AS table_column
        ON table_column.attrelid = table_class.oid
       AND table_column.attnum > 0
       AND NOT table_column.attisdropped
      JOIN pg_depend AS sequence_dependency
        ON sequence_dependency.refobjid = table_class.oid
       AND sequence_dependency.refobjsubid = table_column.attnum
       AND sequence_dependency.classid = 'pg_class'::regclass
       AND sequence_dependency.refclassid = 'pg_class'::regclass
      JOIN pg_class AS sequence_class
        ON sequence_class.oid = sequence_dependency.objid
       AND sequence_class.relkind = 'S'
      JOIN pg_namespace AS sequence_namespace ON sequence_namespace.oid = sequence_class.relnamespace
     WHERE journaled.enabled
  LOOP
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %I.%I TO ops_dml',
      sequence_relation.schema_name,
      sequence_relation.sequence_name
    );
  END LOOP;

  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM ops_dml, ops_ddl';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM ops_dml, ops_ddl';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM ops_dml, ops_ddl';
  EXECUTE 'GRANT USAGE ON SCHEMA _ops TO ops_dml';
  EXECUTE 'GRANT EXECUTE ON FUNCTION _ops.begin_dml_execution(uuid, text, text, text) TO ops_dml';
END
$registered_grants$;

-- ops_ddl is intentionally not made a member of the application owner in this
-- phase. Do not grant it until the DDL runner, schema-drift guard, and sealed
-- break-glass review are deployed and verified.
-- ops_breakglass_login must be provisioned separately; its secret never enters
-- this file, the Ops database, normal worker environment, or browser.

COMMIT;
