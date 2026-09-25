\set ON_ERROR_STOP on

GRANT USAGE, CREATE ON SCHEMA public TO explorer_fixture_owner;

CREATE TABLE public.explorer_students (
  tenant_id text NOT NULL,
  student_id integer NOT NULL,
  PRIMARY KEY (tenant_id, student_id)
);
INSERT INTO public.explorer_students (tenant_id, student_id)
SELECT :'fixture_target', value FROM generate_series(1, 32) AS value;
ALTER TABLE public.explorer_students OWNER TO explorer_fixture_owner;

CREATE TABLE public.explorer_rows (
  id integer PRIMARY KEY,
  safe_value text NOT NULL,
  pii_email text,
  nullable_sort integer,
  tenant_id text NOT NULL,
  student_id integer NOT NULL,
  blocked_token text,
  CONSTRAINT explorer_rows_student_fk
    FOREIGN KEY (tenant_id, student_id)
    REFERENCES public.explorer_students (tenant_id, student_id)
);
INSERT INTO public.explorer_rows (
  id, safe_value, pii_email, nullable_sort, tenant_id, student_id, blocked_token
)
SELECT
  value,
  format('safe-%s-%s', :'fixture_target', value),
  format('user%s@example.invalid', value),
  CASE WHEN value % 4 = 0 THEN NULL ELSE value % 3 END,
  :'fixture_target',
  value,
  format('BLOCKED-SECRET-%s-%s', :'fixture_target', value)
FROM generate_series(1, 32) AS value;
ALTER TABLE public.explorer_rows OWNER TO explorer_fixture_owner;

DO $wide_rows$
DECLARE
  column_definitions text;
  value_expressions text;
BEGIN
  SELECT
    string_agg(format('wide_%s text', lpad(column_index::text, 2, '0')), ', ' ORDER BY column_index),
    string_agg(
      format(
        '(%L || repeat(''W'', 65536 - length(%L)))',
        format('WIDE-ROW-SENTINEL-%s-', lpad(column_index::text, 2, '0')),
        format('WIDE-ROW-SENTINEL-%s-', lpad(column_index::text, 2, '0'))
      ),
      ', ' ORDER BY column_index
    )
  INTO column_definitions, value_expressions
  FROM generate_series(0, 32) AS column_index;

  EXECUTE format('CREATE TABLE public.wide_rows (id integer PRIMARY KEY, %s)', column_definitions);
  EXECUTE format('INSERT INTO public.wide_rows VALUES (1, %s)', value_expressions);
END
$wide_rows$;
ALTER TABLE public.wide_rows OWNER TO explorer_fixture_owner;

CREATE TABLE public.cell_bound (id integer PRIMARY KEY, over_value text NOT NULL);
INSERT INTO public.cell_bound VALUES (1, repeat('C', 65537));
ALTER TABLE public.cell_bound OWNER TO explorer_fixture_owner;

CREATE VIEW public.timeout_probe AS
SELECT CASE WHEN pg_catalog.pg_sleep(16) IS NULL THEN 'slow' ELSE 'slow' END::text AS safe_value;
ALTER VIEW public.timeout_probe OWNER TO explorer_fixture_owner;

ALTER DEFAULT PRIVILEGES FOR ROLE explorer_fixture_owner
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE explorer_fixture_owner
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE explorer_fixture_owner
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE explorer_fixture_owner IN SCHEMA public
  GRANT ALL ON TABLES TO ops_database_browser;
ALTER DEFAULT PRIVILEGES FOR ROLE explorer_fixture_owner IN SCHEMA public
  GRANT ALL ON SEQUENCES TO ops_database_browser;
ALTER DEFAULT PRIVILEGES FOR ROLE explorer_fixture_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO ops_database_browser;
