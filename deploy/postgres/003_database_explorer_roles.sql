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

DO $provisioning_preflight$
DECLARE
  schema_name text;
  schema_owner text := :'ops_schema_owner_role';
  actual_schema_owner text;
BEGIN
  -- Role membership cleanup names each recorded grantor. Require authority to
  -- revoke every such edge before any role or ACL mutation starts.
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user AND rolsuper
  ) THEN
    RAISE EXCEPTION 'Database Explorer provisioning requires a PostgreSQL superuser session';
  END IF;

  IF schema_owner !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'ops_schema_owner_role must be a lower-case PostgreSQL identifier';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = schema_owner) THEN
    RAISE EXCEPTION 'Configured schema owner role does not exist';
  END IF;

  -- PostgreSQL 16 permits object-privilege GRANTED BY only for current_user,
  -- even for a superuser. Detect unapproved CREATE grants from other grantors
  -- now so provisioning fails before its first mutation and can be remediated
  -- in the original grantor's context.
  FOREACH schema_name IN ARRAY string_to_array(:'ops_business_schemas', ',') LOOP
    schema_name := btrim(schema_name);
    IF schema_name !~ '^[a-z][a-z0-9_]{0,62}$' THEN
      RAISE EXCEPTION 'Business schema names must be lower-case PostgreSQL identifiers';
    END IF;
    IF schema_name IN ('_ops', 'pg_catalog', 'information_schema') THEN
      RAISE EXCEPTION 'Business schemas must not include protected schemas';
    END IF;
    SELECT actual_owner_role.rolname
    INTO actual_schema_owner
    FROM pg_namespace namespace
    JOIN pg_roles actual_owner_role ON actual_owner_role.oid = namespace.nspowner
    WHERE namespace.nspname = schema_name;
    IF actual_schema_owner IS NULL THEN
      RAISE EXCEPTION 'Configured business schema does not exist';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_namespace namespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
      ) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = schema_name
        AND acl.privilege_type = 'CREATE'
        AND (
          acl.grantee = 0
          OR grantee.rolname IS NULL
          OR grantee.rolname NOT IN (schema_owner, actual_schema_owner)
        )
        AND acl.grantor <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
    ) THEN
      RAISE EXCEPTION 'Cannot reconcile CREATE ACL on business schema %: PG16 permits GRANTED BY only for current_user. Revoke the unexpected CREATE ACL as its grantor, then rerun provisioning; no role changes were applied', schema_name;
    END IF;
  END LOOP;
END
$provisioning_preflight$;

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

DO $logins$
DECLARE
  browser_login text := :'ops_browser_login';
  target_id text := :'ops_target_id';
  membership record;
  capability_member record;
BEGIN
  IF target_id NOT IN ('edutrack_production', 'ops') THEN
    RAISE EXCEPTION 'Ops browser target must be one of the approved targets';
  END IF;
  IF (target_id = 'edutrack_production' AND browser_login <> 'ops_browser_edutrack')
    OR (target_id = 'ops' AND browser_login <> 'ops_browser_ops') THEN
    RAISE EXCEPTION 'Ops browser login does not match the approved target';
  END IF;

  -- Remove every direct member except this target LOGIN, including LOGINs,
  -- NOLOGIN groups, and grants recorded under a different grantor.
  FOR capability_member IN
    SELECT
      granted_role.rolname AS granted_role,
      member_role.rolname AS member_role,
      grantor.rolname AS grantor_role
    FROM pg_auth_members existing
    JOIN pg_roles granted_role ON granted_role.oid = existing.roleid
    JOIN pg_roles member_role ON member_role.oid = existing.member
    JOIN pg_roles grantor ON grantor.oid = existing.grantor
    WHERE granted_role.rolname = 'ops_database_browser'
      AND member_role.rolname <> browser_login
  LOOP
    EXECUTE format(
      'REVOKE %I FROM %I GRANTED BY %I CASCADE',
      capability_member.granted_role,
      capability_member.member_role,
      capability_member.grantor_role
    );
  END LOOP;

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
      'REVOKE %I FROM %I GRANTED BY %I CASCADE',
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
  IF (
    SELECT count(*)
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    WHERE granted_role.rolname = 'ops_database_browser'
  ) <> 1 OR EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE granted_role.rolname = 'ops_database_browser'
      AND (
        member_role.rolname <> browser_login
        OR NOT membership.inherit_option
        OR membership.set_option
        OR membership.admin_option
      )
  ) THEN
    RAISE EXCEPTION 'ops_database_browser has an unexpected direct member or membership option';
  END IF;
END
$logins$;

-- Do not expose the capability grants until its direct membership is exact.
GRANT CONNECT ON DATABASE :"ops_database_name" TO ops_database_browser;
GRANT USAGE ON SCHEMA pg_catalog TO ops_database_browser;
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
  actual_schema_owner text;
  owner_role text;
  browser_login text := :'ops_browser_login';
  schema_create_grant record;
  grantee_spec text;
  configured_owner_had_create boolean;
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
    SELECT actual_owner_role.rolname
    INTO actual_schema_owner
    FROM pg_namespace namespace
    JOIN pg_roles actual_owner_role ON actual_owner_role.oid = namespace.nspowner
    WHERE namespace.nspname = schema_name;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = schema_owner) THEN
      RAISE EXCEPTION 'Configured schema owner role % does not exist', schema_owner;
    END IF;

    SELECT has_schema_privilege(schema_owner, schema_name, 'CREATE')
    INTO configured_owner_had_create;

    -- Remove direct CREATE ACL entries for PUBLIC and every role except the
    -- configured owner and the actual schema owner. aclexplode identifies the
    -- grantee and grantor for each ACL entry so grants from any owner are seen.
    FOR schema_create_grant IN
      SELECT
        acl.grantee,
        grantee.rolname AS grantee_role
      FROM pg_namespace namespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
      ) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = schema_name
        AND acl.privilege_type = 'CREATE'
        AND (
          acl.grantee = 0
          OR grantee.rolname IS NULL
          OR grantee.rolname NOT IN (schema_owner, actual_schema_owner)
        )
    LOOP
      grantee_spec := CASE
        WHEN schema_create_grant.grantee = 0 THEN 'PUBLIC'
        ELSE format('%I', schema_create_grant.grantee_role)
      END;
      IF grantee_spec IS NULL THEN
        RAISE EXCEPTION 'Could not identify a CREATE grantee on schema %', schema_name;
      END IF;
      -- The preflight proved each unexpected entry was granted by
      -- current_user. Omit GRANTED BY: PostgreSQL 16 rejects a different
      -- object-privilege grantor even when this session is superuser.
      EXECUTE format(
        'REVOKE CREATE ON SCHEMA %I FROM %s CASCADE',
        schema_name,
        grantee_spec
      );
    END LOOP;

    -- Preserve the configured owner’s previous ability if it came only through
    -- PUBLIC or an unapproved group whose CREATE grant was removed above.
    IF configured_owner_had_create AND actual_schema_owner <> schema_owner THEN
      EXECUTE format('GRANT CREATE ON SCHEMA %I TO %I', schema_name, schema_owner);
    END IF;

    -- Fail before commit if role membership still gives an unapproved role
    -- CREATE through an approved owner or any remaining ACL grant.
    IF EXISTS (
      SELECT 1
      FROM pg_namespace namespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
      ) acl
      WHERE namespace.nspname = schema_name
        AND acl.privilege_type = 'CREATE'
        AND (
          acl.grantee = 0
          OR NOT EXISTS (
            SELECT 1
            FROM pg_roles approved
            WHERE approved.oid = acl.grantee
              AND approved.rolname IN (schema_owner, actual_schema_owner)
          )
          OR (
            acl.grantee <> 0
            AND EXISTS (
              SELECT 1
              FROM pg_roles candidate
              WHERE NOT candidate.rolsuper
                AND candidate.rolname NOT IN (schema_owner, actual_schema_owner)
                AND (
                  candidate.oid = acl.grantee
                  OR pg_has_role(candidate.oid, acl.grantee, 'USAGE')
                  OR pg_has_role(candidate.oid, acl.grantee, 'SET')
                )
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Business schema % has an unexpected effective CREATE privilege route', schema_name;
    END IF;

    -- Revoke inherited PUBLIC permissions
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
