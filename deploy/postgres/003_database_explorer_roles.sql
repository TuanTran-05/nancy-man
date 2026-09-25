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
DECLARE
  target_id text := :'ops_target_id';
  other_browser_login text;
BEGIN
  -- The advisory lock is cluster-wide and serializes both target provisioning attempts.
  PERFORM pg_advisory_xact_lock(90260925, 6);

  other_browser_login := CASE target_id
    WHEN 'edutrack_production' THEN 'ops_browser_ops'
    WHEN 'ops' THEN 'ops_browser_edutrack'
    ELSE NULL
  END;
  IF other_browser_login IS NULL THEN
    RAISE EXCEPTION 'Ops browser target must be one of the approved targets';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles other_login
    JOIN pg_roles capability ON capability.rolname = 'ops_database_browser'
    WHERE other_login.rolname = other_browser_login
      AND pg_has_role(other_login.oid, capability.oid, 'member')
  ) THEN
    RAISE EXCEPTION 'ops_database_browser already provisioned for the other target';
  END IF;

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
  membership record;
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

  -- Remove all direct memberships first; this also removes every inherited or SET path.
  FOR membership IN
    SELECT
      granted_role.rolname AS granted_role,
      member_role.rolname AS member_role,
      grantor.rolname AS grantor_role
    FROM pg_auth_members existing
    JOIN pg_roles granted_role ON granted_role.oid = existing.roleid
    JOIN pg_roles member_role ON member_role.oid = existing.member
    JOIN pg_roles grantor ON grantor.oid = existing.grantor
    WHERE member_role.rolname IN (browser_login, 'ops_database_browser')
  LOOP
    EXECUTE format(
      'REVOKE %I FROM %I GRANTED BY %I',
      membership.granted_role,
      membership.member_role,
      membership.grantor_role
    );
  END LOOP;

  EXECUTE format('GRANT ops_database_browser TO %I WITH INHERIT TRUE, SET FALSE', browser_login);
  IF EXISTS (
    WITH RECURSIVE role_closure(role_oid) AS (
      SELECT existing.roleid
      FROM pg_auth_members existing
      JOIN pg_roles member_role ON member_role.oid = existing.member
      WHERE member_role.rolname = browser_login
      UNION
      SELECT membership.roleid
      FROM pg_auth_members membership
      JOIN role_closure parent ON parent.role_oid = membership.member
    )
    SELECT 1
    FROM role_closure reachable
    JOIN pg_roles role_name ON role_name.oid = reachable.role_oid
    WHERE role_name.rolname <> 'ops_database_browser'
  ) THEN
    RAISE EXCEPTION 'Ops browser login has an unexpected role membership';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_auth_members expected
    JOIN pg_roles member_role ON member_role.oid = expected.member
    JOIN pg_roles granted_role ON granted_role.oid = expected.roleid
    WHERE member_role.rolname = browser_login
      AND granted_role.rolname = 'ops_database_browser'
      AND expected.inherit_option
      AND NOT expected.set_option
      AND NOT expected.admin_option
  ) THEN
    RAISE EXCEPTION 'Ops browser login does not have the expected capability membership';
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
  owner_role text;
  browser_login text := :'ops_browser_login';
BEGIN
  IF schema_owner !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'ops_schema_owner_role must be a lower-case PostgreSQL identifier';
  END IF;

  -- Per-schema revokes cannot cancel global defaults, so clear the global ACLs too.
  FOR owner_role IN
    SELECT DISTINCT candidate.rolname
    FROM pg_roles candidate
    WHERE candidate.rolname = schema_owner
       OR candidate.oid IN (
         SELECT namespace.nspowner
         FROM pg_namespace namespace
         WHERE namespace.nspname = '_ops'
            OR namespace.nspname IN (
              SELECT btrim(input_schema.schema_name)
              FROM unnest(string_to_array(:'ops_business_schemas', ',')) AS input_schema(schema_name)
            )
       )
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM PUBLIC', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM ops_database_browser', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM %I', owner_role, browser_login);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM PUBLIC', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM ops_database_browser', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM %I', owner_role, browser_login);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM ops_database_browser', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM %I', owner_role, browser_login);
  END LOOP;

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

    -- Clean both the configured owner and the actual schema owner when they differ.
    FOR owner_role IN
      SELECT DISTINCT candidate.rolname
      FROM pg_roles candidate
      WHERE candidate.rolname = schema_owner
         OR candidate.oid = (SELECT namespace.nspowner FROM pg_namespace namespace WHERE namespace.nspname = schema_name)
    LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC', owner_role, schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM ops_database_browser', owner_role, schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', owner_role, schema_name, browser_login);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC', owner_role, schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM ops_database_browser', owner_role, schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', owner_role, schema_name, browser_login);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', owner_role, schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM ops_database_browser', owner_role, schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM %I', owner_role, schema_name, browser_login);
    END LOOP;
  END LOOP;
END
$business_schemas$;

DO $ops_schema$
DECLARE
  schema_owner text := :'ops_schema_owner_role';
  owner_role text;
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
    FOR owner_role IN
      SELECT DISTINCT candidate.rolname
      FROM pg_roles candidate
      WHERE candidate.rolname = schema_owner
         OR candidate.oid = (SELECT namespace.nspowner FROM pg_namespace namespace WHERE namespace.nspname = '_ops')
    LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON TABLES FROM PUBLIC', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON TABLES FROM ops_database_browser', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON TABLES FROM %I', owner_role, :'ops_browser_login');
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON SEQUENCES FROM PUBLIC', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON SEQUENCES FROM ops_database_browser', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE ALL ON SEQUENCES FROM %I', owner_role, :'ops_browser_login');
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM ops_database_browser', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA _ops REVOKE EXECUTE ON FUNCTIONS FROM %I', owner_role, :'ops_browser_login');
    END LOOP;
  END IF;
END
$ops_schema$;

COMMIT;
