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
\if :{?ops_browser_login}
\else
  \echo 'ops_browser_login is required'
  \quit
\endif
\if :{?ops_target_id}
\else
  \echo 'ops_target_id is required and must be edutrack_production or ops'
  \quit
\endif
\if :{?ops_browser_password}
\else
  \echo 'ops_browser_password is required'
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_database_browser') THEN
    CREATE ROLE ops_database_browser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE ops_database_browser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$roles$;

REVOKE ALL PRIVILEGES ON DATABASE :"ops_database_name" FROM ops_database_browser;
REVOKE TEMPORARY ON DATABASE :"ops_database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"ops_database_name" TO ops_database_browser;
GRANT USAGE ON SCHEMA pg_catalog TO ops_database_browser;

DO $logins$
DECLARE
  browser_login text := :'ops_browser_login';
  target_id text := :'ops_target_id';
BEGIN
  IF target_id NOT IN ('edutrack_production', 'ops') THEN
    RAISE EXCEPTION 'Ops browser target must be one of the approved targets';
  END IF;
  IF (target_id = 'edutrack_production' AND browser_login <> 'ops_browser_edutrack')
    OR (target_id = 'ops' AND browser_login <> 'ops_browser_ops') THEN
    RAISE EXCEPTION 'Ops browser login does not match the approved target';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_login) THEN
    EXECUTE format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L',
      browser_login,
      :'ops_browser_password'
    );
  ELSE
    EXECUTE format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L',
      browser_login,
      :'ops_browser_password'
    );
  END IF;

  EXECUTE format('GRANT ops_database_browser TO %I WITH INHERIT TRUE, SET FALSE', browser_login);
  IF EXISTS (
    SELECT 1
    FROM pg_roles candidate
    WHERE pg_has_role(browser_login, candidate.oid, 'member')
      AND (candidate.rolsuper OR candidate.rolcreatedb OR candidate.rolcreaterole OR candidate.rolreplication OR candidate.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Ops browser login inherits elevated privileges';
  END IF;
END
$logins$;

REVOKE ALL PRIVILEGES ON DATABASE :"ops_database_name" FROM :"ops_browser_login";
ALTER ROLE :"ops_browser_login" SET default_transaction_read_only = 'on';
ALTER ROLE :"ops_browser_login" SET statement_timeout = '15s';
ALTER ROLE :"ops_browser_login" SET lock_timeout = '2s';
ALTER ROLE :"ops_browser_login" SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE :"ops_browser_login" SET search_path = 'pg_catalog';

DO $business_schemas$
DECLARE
  schema_name text;
  schema_owner text := :'ops_schema_owner_role';
  browser_login text := :'ops_browser_login';
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

    -- Revoke inherited PUBLIC permissions
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM ops_database_browser', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %I', schema_name, browser_login);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM ops_database_browser', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM %I', schema_name, browser_login);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM ops_database_browser', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM %I', schema_name, browser_login);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM ops_database_browser', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM %I', schema_name, browser_login);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO ops_database_browser', schema_name);

    -- Ensure default privileges do not grant new tables/sequences/functions to PUBLIC or browser
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM ops_database_browser',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM %I',
      schema_owner,
      schema_name,
      browser_login
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM ops_database_browser',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I',
      schema_owner,
      schema_name,
      browser_login
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM ops_database_browser',
      schema_owner,
      schema_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM %I',
      schema_owner,
      schema_name,
      browser_login
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
    REVOKE ALL ON SCHEMA _ops FROM ops_database_browser;
    EXECUTE format('REVOKE ALL ON SCHEMA _ops FROM %I', :'ops_browser_login');
    REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM PUBLIC;
    REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM ops_database_browser;
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA _ops FROM %I', :'ops_browser_login');
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM PUBLIC;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM ops_database_browser;
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA _ops FROM %I', :'ops_browser_login');
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM PUBLIC;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM ops_database_browser;
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA _ops FROM %I', :'ops_browser_login');
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON TABLES FROM PUBLIC',
      schema_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON TABLES FROM ops_database_browser',
      schema_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON TABLES FROM %I',
      schema_owner,
      :'ops_browser_login'
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON SEQUENCES FROM PUBLIC',
      schema_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON SEQUENCES FROM ops_database_browser',
      schema_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON SEQUENCES FROM %I',
      schema_owner,
      :'ops_browser_login'
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
      schema_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM ops_database_browser',
      schema_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM %I',
      schema_owner,
      :'ops_browser_login'
    );
  END IF;
END
$ops_schema$;

COMMIT;
