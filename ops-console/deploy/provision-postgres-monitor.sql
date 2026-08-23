BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_metrics_owner') THEN
    CREATE ROLE ops_metrics_owner NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_monitor') THEN
    CREATE ROLE ops_monitor LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE ops_metrics_owner NOLOGIN NOINHERIT;
ALTER ROLE ops_monitor LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ops_monitor PASSWORD :'ops_monitor_password';

CREATE SCHEMA IF NOT EXISTS ops_metrics AUTHORIZATION ops_metrics_owner;
REVOKE ALL ON SCHEMA ops_metrics FROM PUBLIC;

CREATE OR REPLACE FUNCTION ops_metrics.snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'probeAt', clock_timestamp(),
    'databaseSizeBytes', pg_database_size(current_database()),
    'connectionStates', COALESCE((
      SELECT jsonb_object_agg(COALESCE(state, 'unknown'), state_count)
      FROM (
        SELECT state, COUNT(*)::integer AS state_count
        FROM pg_stat_activity
        GROUP BY state
      ) state_counts
    ), '{}'::jsonb),
    'activeCount', (SELECT COUNT(*)::integer FROM pg_stat_activity WHERE state = 'active'),
    'waitingLockCount', (SELECT COUNT(*)::integer FROM pg_stat_activity WHERE wait_event_type = 'Lock'),
    'deadlocks', COALESCE((SELECT SUM(deadlocks)::bigint FROM pg_stat_database), 0),
    'rollbacks', COALESCE((SELECT SUM(xact_rollback)::bigint FROM pg_stat_database), 0),
    'tempFiles', COALESCE((SELECT SUM(temp_files)::bigint FROM pg_stat_database), 0),
    'tempBytes', COALESCE((SELECT SUM(temp_bytes)::bigint FROM pg_stat_database), 0),
    'userTables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table', relname,
        'liveTuples', n_live_tup,
        'deadTuples', n_dead_tup,
        'lastAutovacuum', last_autovacuum,
        'lastAutoanalyze', last_autoanalyze
      ) ORDER BY relname)
      FROM pg_stat_user_tables
    ), '[]'::jsonb),
    'settings', jsonb_build_object(
      'maxConnections', current_setting('max_connections')::integer,
      'trackIoTiming', current_setting('track_io_timing') = 'on',
      'extensions', COALESCE((
        SELECT jsonb_agg(extname ORDER BY extname)
        FROM pg_extension
        WHERE extname IN ('pg_stat_monitor', 'auto_explain')
      ), '[]'::jsonb)
    )
  );
$$;

ALTER FUNCTION ops_metrics.snapshot() OWNER TO ops_metrics_owner;
REVOKE ALL ON SCHEMA ops_metrics FROM PUBLIC;
REVOKE ALL ON FUNCTION ops_metrics.snapshot() FROM PUBLIC;
GRANT USAGE ON SCHEMA ops_metrics TO ops_monitor;
GRANT EXECUTE ON FUNCTION ops_metrics.snapshot() TO ops_monitor;

COMMIT;
