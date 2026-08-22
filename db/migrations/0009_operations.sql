-- 0009_operations.sql
-- Nhat ky, hang doi, job nen, yeu cau in.

BEGIN;

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
-- Day la cho JSONB DUNG cho: payload that su di dang theo tung loai hanh dong
-- (3000 doc mau sinh ra 265 duong truong khac nhau).
--
-- Luu y: userRole tren production KHONG phai tap dong. Ngoai
-- admin/office/teacher/accounting/student/system/unknown con co gia tri
-- 'TRAN ANH TUAN' — mot cai TEN lot vao o vai tro. Vi vay khong dat CHECK
-- tren cot nay: mot rang buoc lam fail buoc nap cua so nhat ky lich su thi
-- doi lay gia tri bang khong.
CREATE TABLE audit_logs (
  id           TEXT PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL,
  user_id      TEXT NOT NULL,
  user_role    TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  ip           INET,
  user_agent   TEXT,
  changes      JSONB,
  metadata     JSONB
);

-- BRIN thay vi B-tree: bang nay chi them, khoa doc theo thoi gian, va se lon
-- nhanh nhat trong toan schema. BRIN ton vai chuc KB thay vi vai tram MB.
CREATE INDEX audit_logs_occurred_brin ON audit_logs USING brin (occurred_at);
CREATE INDEX audit_logs_entity_idx    ON audit_logs (entity_table, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_user_idx      ON audit_logs (user_id, occurred_at DESC);
CREATE INDEX audit_logs_action_idx    ON audit_logs (action, occurred_at DESC);

COMMENT ON COLUMN audit_logs.entity_table IS
  'Doi ten tu truong `collection` cua Firestore. Khong dat FK: nhat ky phai song sot ca khi ban ghi goc bien mat.';
COMMENT ON COLUMN audit_logs.ip IS
  'Kieu INET thay vi TEXT. Buoc nap phai bo qua gia tri khong phai dia chi IP hop le thay vi lam fail ca me.';

-- ---------------------------------------------------------------------------
-- outbox_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_jobs (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,
  idempotency_key       TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts              SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts          SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_run_at           TIMESTAMPTZ NOT NULL,
  locked_by             TEXT,
  processing_started_at TIMESTAMPTZ,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Chan chen trung cong viec bang rang buoc thay vi bang kiem tra trong code.
  CONSTRAINT outbox_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT outbox_lock_pair CHECK ((locked_by IS NULL) = (processing_started_at IS NULL))
);

-- Index chi phuc vu vong lay viec: hang da xong khong nam trong index.
CREATE INDEX outbox_jobs_ready_idx ON outbox_jobs (next_run_at)
  WHERE status IN ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- jobs / job_runs
-- ---------------------------------------------------------------------------
-- Hai collection nay co that tren production (120 va 3 doc) nhung tai lieu
-- thiet ke khong nhac toi. Chung la co so de biet cron co chay khong —
-- dung thu tung thieu khi cron gop ngay 2026-07-18 chet ma khong ai biet.
CREATE TABLE jobs (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  params            JSONB NOT NULL DEFAULT '{}'::jsonb,
  result            JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts          SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  requested_by_id   TEXT REFERENCES users (id) ON DELETE RESTRICT,
  requested_by_role TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  duration_ms       INTEGER CHECK (duration_ms >= 0),
  schema_version    SMALLINT NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT job_completion_order CHECK (
    completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at
  )
);

CREATE INDEX jobs_kind_idx    ON jobs (kind, created_at DESC);
CREATE INDEX jobs_running_idx ON jobs (created_at DESC) WHERE status IN ('queued', 'running');

-- Mot hang cho moi job dinh ky, ghi de moi lan chay. Day la cho de tra loi
-- "cron nay chay lan cuoi luc nao" ma khong phai quet ca bang jobs.
CREATE TABLE job_runs (
  job_name      TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  checked       INTEGER NOT NULL DEFAULT 0 CHECK (checked >= 0),
  changed       INTEGER NOT NULL DEFAULT 0 CHECK (changed >= 0),
  cursor        TEXT,
  error_code    TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT job_run_order CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT job_run_finished_unless_running CHECK (status = 'running' OR finished_at IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- print_requests
-- ---------------------------------------------------------------------------
-- Khong co document nao tren production nhung code van ghi. Bo cot teacherName
-- va className (muc 1.7).
CREATE TABLE print_requests (
  id           TEXT PRIMARY KEY,
  teacher_id   TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  class_id     TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  title        TEXT NOT NULL,
  note         TEXT,
  copies       SMALLINT NOT NULL DEFAULT 1 CHECK (copies > 0),
  needed_by    DATE,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'printed', 'rejected', 'cancelled')),
  handled_by   TEXT REFERENCES users (id) ON DELETE RESTRICT,
  handled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT print_request_handled_pair CHECK ((handled_at IS NULL) = (handled_by IS NULL))
);

CREATE INDEX print_requests_status_idx ON print_requests (status, created_at DESC);

CREATE TABLE print_request_files (
  id                TEXT PRIMARY KEY,
  print_request_id  TEXT NOT NULL REFERENCES print_requests (id) ON DELETE CASCADE,
  position          SMALLINT NOT NULL CHECK (position > 0),
  storage_path      TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type         TEXT,
  file_size         BIGINT CHECK (file_size >= 0),

  CONSTRAINT print_request_file_position_key UNIQUE (print_request_id, position)
);

-- ---------------------------------------------------------------------------
-- schema_migrations
-- ---------------------------------------------------------------------------
-- So theo doi chinh cac file trong thu muc nay. Thay _schema_migrations cua
-- Firestore. Bang duy nhat khong bi migration nao dung toi sau khi tao.
--
-- IF NOT EXISTS la bat buoc: run-migrations.sh phai tao bang nay TRUOC ca 0001
-- (no can cho de ghi lai 0001..0008 da chay chua), nen den luot 0009 thi bang da
-- co san. Dinh nghia o day va o run-migrations.sh phai giong het nhau.
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename     TEXT PRIMARY KEY,
  checksum     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  error        TEXT
);

-- ---------------------------------------------------------------------------
-- student_enrollment_migration_journal  — kho luu tru dong bang
-- ---------------------------------------------------------------------------
-- 334 doc tren production, tat ca tu mot lan chay ngay 2026-08-01. Day la
-- bang chung ve mot dot di tru da xong. Khong FK (giong tuition_records):
-- documentId tro toi enrollment co the da bi thay the.
CREATE TABLE student_enrollment_migration_journal (
  id                  TEXT PRIMARY KEY,
  migration_id        TEXT NOT NULL,
  run_id              TEXT NOT NULL,
  student_id          TEXT NOT NULL,
  document_id         TEXT NOT NULL,
  digest              TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  target_project_id   TEXT NOT NULL,
  target_database_id  TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX enrollment_journal_run_idx ON student_enrollment_migration_journal (run_id);

COMMENT ON TABLE student_enrollment_migration_journal IS
  'DONG BANG. Khong FK, khong duong ghi. Bang chung ve dot backfill enrollment ngay 2026-08-01.';

REVOKE INSERT, UPDATE, DELETE ON student_enrollment_migration_journal FROM PUBLIC;

SELECT app_attach_touch('outbox_jobs');
SELECT app_attach_touch('jobs');
SELECT app_attach_touch('job_runs');
SELECT app_attach_touch('print_requests');

COMMIT;
