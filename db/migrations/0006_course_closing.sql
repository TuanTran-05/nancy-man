-- 0006_course_closing.sql
-- Ket khoa khoa hoc.
--
-- CourseClosingState dang nhung trong CA `Class` LAN `ClassTerm` — hai ban sao
-- cua cung mot su that (production: 2 doc o cap lop, 15 o cap ky). Sau chuan
-- hoa chi con mot hang gan voi class_terms.
--
-- CourseClosingSnapshot KHONG luu — no la ket qua thuan cua
-- deriveCourseClosingSnapshot(), tinh khi can.

BEGIN;

CREATE TABLE course_closings (
  id                      TEXT PRIMARY KEY,
  term_id                 TEXT NOT NULL REFERENCES class_terms (id) ON DELETE RESTRICT,
  course_id               TEXT,
  term_start              DATE NOT NULL,
  term_end                DATE,

  approval_status         TEXT CHECK (approval_status IN ('pending', 'approved', 'invalidated')),
  approved_at             TIMESTAMPTZ,
  approved_by             TEXT REFERENCES users (id) ON DELETE RESTRICT,
  approved_by_role        TEXT CHECK (approved_by_role IN ('teacher', 'admin', 'office')),
  approval_source         TEXT CHECK (approval_source IN ('teacher', 'admin', 'system')),

  -- Van tay chot trang thai roster va bang danh gia luc duyet. Neu du lieu doi
  -- sau do, van tay lech va phe duyet bi vo hieu — day la bang chung, khong
  -- phai cache.
  roster_fingerprint      TEXT,
  evaluation_fingerprint  TEXT,

  invalidated_at          TIMESTAMPTZ,
  invalidated_by          TEXT REFERENCES users (id) ON DELETE RESTRICT,
  invalidated_reason      TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Mot ky chi ket khoa mot lan. Day la thu chan hai ban sao quay lai.
  CONSTRAINT course_closing_term_key UNIQUE (term_id),

  CONSTRAINT course_closing_approved_complete CHECK (
    approval_status IS DISTINCT FROM 'approved'
    OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT course_closing_invalidated_complete CHECK (
    approval_status IS DISTINCT FROM 'invalidated'
    OR (invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)
  ),
  CONSTRAINT course_closing_term_order CHECK (term_end IS NULL OR term_end >= term_start)
);

CREATE INDEX course_closings_status_idx ON course_closings (approval_status);

-- Hoc sinh duoc mien khoi dieu kien ket khoa cua mot ky.
CREATE TABLE course_closing_exemptions (
  id          TEXT PRIMARY KEY,
  closing_id  TEXT NOT NULL REFERENCES course_closings (id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  reason      TEXT,
  granted_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT course_closing_exemption_key UNIQUE (closing_id, student_id)
);

-- ---------------------------------------------------------------------------
-- course_closing_records
-- ---------------------------------------------------------------------------
-- Cac cot *_snapshot o day GIU LAI (ngoai le muc 1.7): chung la bang chung ve
-- trang thai tai thoi diem phat hanh giay bao, khong phai cache de doc nhanh.
-- Doc ID cu la '{courseId}__{studentId}'.
CREATE TABLE course_closing_records (
  id                     TEXT PRIMARY KEY,
  class_id               TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  term_id                TEXT REFERENCES class_terms (id) ON DELETE RESTRICT,
  student_id             TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  teacher_id             TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  course_id              TEXT NOT NULL,
  closing_month          TEXT NOT NULL CHECK (closing_month ~ '^\d{4}-\d{2}$'),
  course_start_date      DATE NOT NULL,
  course_end_date        DATE NOT NULL,
  record_version         SMALLINT NOT NULL DEFAULT 1,

  -- Anh chup danh tinh luc phat hanh.
  student_code_snapshot  TEXT NOT NULL,
  student_name_snapshot  TEXT NOT NULL,
  class_name_snapshot    TEXT NOT NULL,
  teacher_name_snapshot  TEXT NOT NULL,

  -- Anh chup ket qua hoc tap luc phat hanh.
  evaluation_id                   TEXT,
  evaluation_version              TEXT,
  evaluation_date_snapshot        DATE,
  evaluation_classification       TEXT CHECK (evaluation_classification IN
                                    ('excellent', 'good', 'fair', 'failing')),
  evaluation_final_score          SMALLINT CHECK (evaluation_final_score BETWEEN 0 AND 100),
  evaluation_total_score          SMALLINT CHECK (evaluation_total_score BETWEEN 0 AND 100),
  evaluation_positive_points      TEXT[] NOT NULL DEFAULT '{}',
  evaluation_improvement_points   TEXT,
  evaluation_scores_snapshot      JSONB,
  evaluation_midterm_snapshot     JSONB,

  -- Anh chup hoc phi khoa ke tiep luc phat hanh.
  tuition_ledger_id               TEXT,
  tuition_amount_snapshot         NUMERIC(14, 2) CHECK (tuition_amount_snapshot >= 0),
  tuition_notice_date             DATE,
  next_course_start_date          DATE,
  next_course_end_date            DATE,
  tuition_final_exam_date         DATE,
  tuition_final_exam_score        SMALLINT CHECK (tuition_final_exam_score BETWEEN 0 AND 100),

  evaluation_availability_status  TEXT CHECK (evaluation_availability_status IN ('verified', 'unavailable')),
  evaluation_availability_reason  TEXT,
  evaluation_availability_assessed_at TIMESTAMPTZ,
  tuition_availability_status     TEXT CHECK (tuition_availability_status IN ('verified', 'unavailable')),
  tuition_availability_reason     TEXT,
  tuition_availability_assessed_at TIMESTAMPTZ,

  backfilled_at          TIMESTAMPTZ,
  backfill_source_digest TEXT,
  backfill_version       SMALLINT,
  repair_source          TEXT,
  repaired_at            TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT closing_record_course_student_key UNIQUE (course_id, student_id),
  CONSTRAINT closing_record_date_order CHECK (course_end_date >= course_start_date)
);

CREATE INDEX closing_records_class_idx   ON course_closing_records (class_id, closing_month DESC);
CREATE INDEX closing_records_student_idx ON course_closing_records (student_id, closing_month DESC);
CREATE INDEX closing_records_month_idx   ON course_closing_records (closing_month);

-- Hai loai giay to sinh ra cho moi ban ghi ket khoa (danh gia + hoc phi).
-- Tren Firestore chung la hai map evaluationDocument / tuitionDocument co cung
-- hinh dang; o day la hai hang phan biet boi cot kind.
CREATE TABLE course_closing_record_documents (
  id                      TEXT PRIMARY KEY,
  record_id               TEXT NOT NULL REFERENCES course_closing_records (id) ON DELETE CASCADE,
  kind                    TEXT NOT NULL CHECK (kind IN ('evaluation', 'tuition')),
  status                  TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  storage_path            TEXT,
  preview_storage_path    TEXT,
  download_filename       TEXT,
  mime_type               TEXT,
  template_version        SMALLINT NOT NULL DEFAULT 1,
  attempts                SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  generated_at            TIMESTAMPTZ,
  last_attempt_at         TIMESTAMPTZ,
  source_notification_id  TEXT,

  CONSTRAINT closing_document_kind_key UNIQUE (record_id, kind),
  CONSTRAINT closing_document_ready_has_file CHECK (
    status <> 'ready' OR (storage_path IS NOT NULL AND generated_at IS NOT NULL)
  )
);

SELECT app_attach_touch('course_closings');
SELECT app_attach_touch('course_closing_records');

COMMIT;
