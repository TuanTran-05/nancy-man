-- verify-schema.sql
-- Chay SAU khi run-migrations.sh xong, de doi chieu voi con so da do o may dev:
--
--   psql "$DATABASE_URL" -f db/verify-schema.sql
--
-- Cot "ket qua" phai la OK het. Bat ky dong FAIL nao nghia la schema tren VPS
-- khac voi schema da duoc dien tap — dung nap du lieu, doc thong bao truoc.

\pset border 2
\pset title 'Doi chieu schema'

WITH actual AS (
  SELECT
    (SELECT count(*) FROM pg_tables    WHERE schemaname = 'public')                    AS tables,
    (SELECT count(*) FROM pg_views     WHERE schemaname = 'public')                    AS views,
    (SELECT count(*) FROM pg_matviews  WHERE schemaname = 'public')                    AS matviews,
    (SELECT count(*) FROM pg_indexes   WHERE schemaname = 'public')                    AS indexes,
    (SELECT count(*) FROM pg_constraint WHERE contype = 'f')                           AS foreign_keys,
    (SELECT count(*) FROM pg_constraint WHERE contype = 'c'
       AND connamespace = 'public'::regnamespace)                                      AS checks,
    (SELECT count(*) FROM pg_constraint WHERE contype = 'u')                           AS uniques,
    (SELECT count(*) FROM pg_constraint WHERE contype = 'x')                           AS excludes,
    (SELECT count(*) FROM pg_trigger   WHERE NOT tgisinternal)                         AS triggers,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'app\_%')                         AS functions
),
expected (name, want) AS (VALUES
  ('bang',            85),
  ('view',             8),
  ('materialized view', 2),
  ('index',          228),
  ('khoa ngoai',     177),
  ('CHECK',          244),
  ('UNIQUE',          85),
  ('EXCLUDE',          0),
  ('trigger',         65),
  ('ham app_*',       14)
),
got (name, have) AS (
  SELECT 'bang', tables FROM actual
  UNION ALL SELECT 'view', views FROM actual
  UNION ALL SELECT 'materialized view', matviews FROM actual
  UNION ALL SELECT 'index', indexes FROM actual
  UNION ALL SELECT 'khoa ngoai', foreign_keys FROM actual
  UNION ALL SELECT 'CHECK', checks FROM actual
  UNION ALL SELECT 'UNIQUE', uniques FROM actual
  UNION ALL SELECT 'EXCLUDE', excludes FROM actual
  UNION ALL SELECT 'trigger', triggers FROM actual
  UNION ALL SELECT 'ham app_*', functions FROM actual
)
SELECT
  e.name                                        AS "doi tuong",
  e.want                                        AS "mong doi",
  g.have                                        AS "thuc te",
  CASE WHEN e.want = g.have THEN 'OK' ELSE 'FAIL' END AS "ket qua"
FROM expected e JOIN got g USING (name)
ORDER BY CASE WHEN e.want = g.have THEN 1 ELSE 0 END, e.name;

\pset title 'Extension'
SELECT extname AS "ten",
       CASE WHEN extname IS NULL THEN 'FAIL' ELSE 'OK' END AS "ket qua"
FROM pg_extension
WHERE extname IN ('btree_gist', 'pg_trgm', 'unaccent')
ORDER BY extname;

\pset title 'Extension con thieu'
SELECT need AS "thieu"
FROM unnest(ARRAY['btree_gist', 'pg_trgm', 'unaccent']) AS need
WHERE need NOT IN (SELECT extname FROM pg_extension);

\pset title 'Ham chuan hoa (phai tra dung ket qua nay)'
SELECT
  app_normalize_text('  Trần   Thị  Quỳnh  Như ') AS "normalize_text",
  app_normalize_text('Đặng Đình Đô')              AS "d gach ngang",
  app_display_name('  tran   anh  tuan  ')        AS "display_name",
  app_normalize_code('  hs260847 ')               AS "normalize_code";
-- Mong doi:  TRAN THI QUYNH NHU | DANG DINH DO | TRAN ANH TUAN | HS260847

\pset title 'Bang da chay migration'
SELECT filename AS "file", status AS "trang thai", finished_at AS "xong luc"
FROM schema_migrations ORDER BY filename;

\pset title 'So hang tung bang (sau khi nap se khac 0)'
SELECT relname AS "bang", n_live_tup AS "so hang uoc tinh"
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_live_tup DESC;
