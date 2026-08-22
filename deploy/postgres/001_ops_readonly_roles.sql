\set ON_ERROR_STOP on

\if :{?ops_database_name}
\else
  \echo 'ops_database_name is required'
  \quit
\endif
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
\if :{?ops_read_login}
\else
  \echo 'ops_read_login is required'
  \quit
\endif
\if :{?ops_read_password}
\else
  \echo 'ops_read_password is required'
  \quit
\endif
\if :{?ops_cancel_login}
\else
  \echo 'ops_cancel_login is required'
  \quit
\endif
\if :{?ops_cancel_password}
\else
  \echo 'ops_cancel_password is required'
  \quit
\endif
\if :{?ops_revoke_public_privileges}
\else
  \echo 'ops_revoke_public_privileges must be explicitly set to true'
  \quit
\endif
\if :ops_revoke_public_privileges
\else
  \echo 'ops_revoke_public_privileges must be true; PUBLIC grants could otherwise bypass this role policy'
  \quit
\endif

BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_readonly') THEN
    CREATE ROLE ops_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_cancel') THEN
    CREATE ROLE ops_cancel NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$roles$;

REVOKE ALL PRIVILEGES ON DATABASE :"ops_database_name" FROM ops_readonly, ops_cancel;
-- Every login receives PUBLIC privileges. A direct REVOKE from ops_readonly is
-- insufficient, so TEMP must be removed from PUBLIC before the read login exists.
REVOKE TEMPORARY ON DATABASE :"ops_database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"ops_database_name" TO ops_readonly, ops_cancel;
GRANT USAGE ON SCHEMA pg_catalog TO ops_readonly, ops_cancel;
GRANT pg_signal_backend TO ops_cancel;

DO $logins$
DECLARE
  read_login text := :'ops_read_login';
  cancel_login text := :'ops_cancel_login';
BEGIN
  IF read_login !~ '^[a-z][a-z0-9_]{0,62}$'
    OR cancel_login !~ '^[a-z][a-z0-9_]{0,62}$'
    OR read_login IN ('ops_readonly', 'ops_cancel')
    OR cancel_login IN ('ops_readonly', 'ops_cancel')
    OR read_login = cancel_login THEN
    RAISE EXCEPTION 'Ops login names must be distinct lower-case PostgreSQL identifiers';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = read_login) THEN
    EXECUTE format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L',
      read_login,
      :'ops_read_password'
    );
  ELSE
    EXECUTE format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L',
      read_login,
      :'ops_read_password'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = cancel_login) THEN
    EXECUTE format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD %L',
      cancel_login,
      :'ops_cancel_password'
    );
  ELSE
    EXECUTE format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD %L',
      cancel_login,
      :'ops_cancel_password'
    );
  END IF;

  EXECUTE format('REVOKE ops_cancel, pg_signal_backend FROM %I', read_login);
  EXECUTE format('REVOKE ops_readonly FROM %I', cancel_login);
  EXECUTE format('GRANT ops_readonly TO %I WITH INHERIT TRUE, SET FALSE', read_login);
  EXECUTE format('GRANT ops_cancel TO %I WITH INHERIT TRUE, SET FALSE', cancel_login);
END
$logins$;

ALTER ROLE :"ops_read_login" SET default_transaction_read_only = 'on';
ALTER ROLE :"ops_read_login" SET statement_timeout = '30s';
ALTER ROLE :"ops_read_login" SET lock_timeout = '3s';
ALTER ROLE :"ops_read_login" SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE :"ops_read_login" SET search_path = 'pg_catalog';
ALTER ROLE :"ops_cancel_login" SET default_transaction_read_only = 'on';
ALTER ROLE :"ops_cancel_login" SET statement_timeout = '10s';
ALTER ROLE :"ops_cancel_login" SET lock_timeout = '3s';
ALTER ROLE :"ops_cancel_login" SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE :"ops_cancel_login" SET search_path = 'pg_catalog';

DO $business_schemas$
DECLARE
  schema_name text;
  schema_owner text := :'ops_schema_owner_role';
BEGIN
  IF schema_owner !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'ops_schema_owner_role must be a lower-case PostgreSQL identifier';
  END IF;

  FOREACH schema_name IN ARRAY string_to_array(:'ops_business_schemas', ',') LOOP
    schema_name := btrim(schema_name);
    IF schema_name !~ '^[a-z][a-z0-9_]{0,62}$' THEN
      RAISE EXCEPTION 'Business schema names must be lower-case PostgreSQL identifiers';
    END IF;
    IF schema_name IN ('_ops', 'pg_catalog', 'information_schema') THEN
      RAISE EXCEPTION 'Business schemas must not include protected schema %', schema_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name) THEN
      RAISE EXCEPTION 'Business schema % does not exist', schema_name;
    END IF;

    -- PUBLIC grants are inherited by every login. Removing every implicit
    -- table/sequence/function path is necessary before explicit SELECT is
    -- granted to ops_readonly.
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM ops_cancel', schema_name);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO ops_readonly', schema_name);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO ops_readonly', schema_name);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO ops_readonly', schema_name);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO ops_readonly',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON SEQUENCES TO ops_readonly',
      schema_owner,
      schema_name
    );
  END LOOP;
END
$business_schemas$;

DO $ops_schema$
DECLARE
  schema_owner text := :'ops_schema_owner_role';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '_ops') THEN
    REVOKE ALL ON SCHEMA _ops FROM PUBLIC;
    REVOKE ALL ON SCHEMA _ops FROM ops_readonly, ops_cancel;
    REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM PUBLIC;
    REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM ops_readonly, ops_cancel;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM PUBLIC;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM ops_readonly, ops_cancel;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM PUBLIC;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM ops_readonly, ops_cancel;
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
      schema_owner
    );
  END IF;
END
$ops_schema$;

COMMIT;
