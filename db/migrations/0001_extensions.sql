-- 0001_extensions.sql
-- Nen tang: extension, schema, ham tien ich dung chung.
--
-- Moi quy uoc o day deu sinh ra tu mot so do trong du lieu production
-- (do ngay 2026-08-19 tren database ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a,
-- 54 collection / ~30.000 document). Xem db/README.md muc "Bang chung".

BEGIN;

-- btree_gist: can cho rang buoc EXCLUDE chong hai ky hoc chong lan tren cung mot lop
-- (class_terms). Do tren production: 0/31 lop dang vi pham, nen bat duoc ngay.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- pg_trgm: index tim kiem ten hoc sinh (students.name_normalized).
-- Thay cho mang searchTokens[] dai toi 28 phan tu ma Firestore phai luu san.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent: bo dau tieng Viet khi chuan hoa ten.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------------
-- Chuan hoa van ban
-- ---------------------------------------------------------------------------

-- Ban SQL cua normalizeStudentText() trong shared/studentRecords.ts:
--   NFD -> bo dau -> d/D thanh d/D -> gom khoang trang -> trim -> UPPERCASE
-- Dung IMMUTABLE de xai duoc trong generated column va index.
-- unaccent() cua extension la STABLE chu khong IMMUTABLE, nen goi qua
-- regexp_replace tren dang NFD thay vi goi unaccent() truc tiep.
CREATE OR REPLACE FUNCTION app_normalize_text(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- unaccent(regdictionary, text) la IMMUTABLE (khac unaccent(text) chi STABLE),
  -- nen dung duoc trong generated column va index. Tu dien 'unaccent' mac dinh
  -- da xu ly ca U+0111 (d gach ngang) lan cac dau ket hop U+0300..U+036F, tuc
  -- dung hai buoc ma normalizeStudentText() trong shared/studentRecords.ts lam
  -- bang tay.
  SELECT upper(
    btrim(
      regexp_replace(
        unaccent('unaccent'::regdictionary, coalesce(value, '')),
        '\s+', ' ', 'g'
      )
    )
  );
$$;

-- Ban SQL cua formatStudentDisplayName(): giu nguyen dau, chi gom khoang trang
-- va viet hoa. Dung cho students.name.
CREATE OR REPLACE FUNCTION app_display_name(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(btrim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g')));
$$;

-- Chuan hoa ma hoc sinh: chi trim + viet hoa (ma la HS + 6 chu so, khong co dau).
CREATE OR REPLACE FUNCTION app_normalize_code(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(btrim(coalesce(value, '')));
$$;

-- ---------------------------------------------------------------------------
-- updated_at tu dong
-- ---------------------------------------------------------------------------
-- Tren Firestore, updated_at do tung doan code tu ghi, va da lech: 486/802
-- students luu chuoi ISO trong khi 316 luu Timestamp; users la 68 chuoi / 49
-- Timestamp. Trigger nay khien khong con duong nao ghi sai kieu nua.
CREATE OR REPLACE FUNCTION app_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Gan trigger touch cho mot bang bat ky co cot updated_at.
CREATE OR REPLACE FUNCTION app_attach_touch(target regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  trigger_name TEXT := 'trg_touch_updated_at';
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS %I ON %s', trigger_name, target::text
  );
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at()',
    trigger_name, target::text
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- So biên lai
-- ---------------------------------------------------------------------------
-- Thay counterSequence.ts (mot transaction Firestore doc-doi-ghi tren
-- _counters/{name}). Production co 30 counter, seq cao nhat 906.
-- Sequence cua Postgres lam dung viec do, khong khoa, khong retry.
CREATE SEQUENCE IF NOT EXISTS receipt_no_seq AS BIGINT START WITH 1;

-- ---------------------------------------------------------------------------
-- Kenh realtime
-- ---------------------------------------------------------------------------
-- Collection realtime_events (20 doc, moi doc mot kenh + so version tang dan)
-- khong duoc port. Thay bang LISTEN/NOTIFY. Ham nay la mot cho duy nhat de
-- phat tin hieu, giu nguyen ten kenh dang dung trong
-- server/api/lib/realtime/events.ts.
CREATE OR REPLACE FUNCTION app_notify(channel TEXT, target_id TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'app_realtime',
    json_build_object('channel', channel, 'targetId', target_id, 'at', now())::text
  );
END;
$$;

COMMIT;
