-- 0004_assignments.sql
-- Bai tap, bai nop, ngan hoc lieu.
--
-- Assignment.questions[] tach ba tang: assignment -> question -> option.
-- Tren Firestore, questions[].id la mot SO NGUYEN (epoch ms, vd 1775830383537)
-- va submissions.quizAnswers[].questionId tro toi chinh so do. Giu lai so do o
-- cot legacy_question_key de buoc nap noi duoc hai ben, con khoa chinh la
-- khoa thay the theo quy uoc 1.1.

BEGIN;

CREATE TABLE assignments (
  id               TEXT PRIMARY KEY,
  class_id         TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  teacher_id       TEXT NOT NULL REFERENCES users (id)   ON DELETE RESTRICT,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  type             TEXT NOT NULL CHECK (type IN ('quiz', 'essay', 'assessment')),
  -- Firestore luu chuoi 'YYYY-MM-DDTHH:mm' khong co mui gio. Buoc nap phai
  -- dien giai theo Asia/Ho_Chi_Minh roi doi sang UTC.
  due_date         TIMESTAMPTZ,
  attempts_allowed SMALLINT NOT NULL DEFAULT 1 CHECK (attempts_allowed > 0),

  -- Cau hinh long nhieu tang, it truy van -> JSONB dung cho.
  assessment       JSONB,
  delivery_policy  JSONB,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX assignments_class_idx ON assignments (class_id, due_date DESC);

CREATE TABLE assignment_questions (
  id                  TEXT PRIMARY KEY,
  assignment_id       TEXT NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
  position            SMALLINT NOT NULL CHECK (position > 0),
  legacy_question_key BIGINT,
  question_content    TEXT NOT NULL,
  level               TEXT CHECK (level IN
                        ('Nhận biết', 'Thông hiểu', 'Vận dụng thấp', 'Vận dụng cao')),
  correct_answer      TEXT NOT NULL,

  CONSTRAINT assignment_question_position_key UNIQUE (assignment_id, position),
  CONSTRAINT assignment_question_legacy_key   UNIQUE (assignment_id, legacy_question_key)
);

CREATE TABLE assignment_question_options (
  id           TEXT PRIMARY KEY,
  question_id  TEXT NOT NULL REFERENCES assignment_questions (id) ON DELETE CASCADE,
  option_key   TEXT NOT NULL,
  option_text  TEXT NOT NULL,

  CONSTRAINT assignment_option_key UNIQUE (question_id, option_key)
);

-- correct_answer phai tro toi mot option co that. CHECK mot hang khong dien ta
-- noi dieu do; FK ghep thi dien ta duoc, vi assignment_question_options da co
-- UNIQUE (question_id, option_key).
ALTER TABLE assignment_questions
  ADD CONSTRAINT assignment_question_answer_exists
  FOREIGN KEY (id, correct_answer)
  REFERENCES assignment_question_options (question_id, option_key)
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT assignment_question_answer_exists ON assignment_questions IS
  'DEFERRABLE vi cau hoi phai ton tai truoc khi chen phuong an; kiem tra o cuoi transaction.';

CREATE TABLE submissions (
  id               TEXT PRIMARY KEY,
  assignment_id    TEXT NOT NULL REFERENCES assignments (id) ON DELETE RESTRICT,
  student_id       TEXT NOT NULL REFERENCES students (id)    ON DELETE RESTRICT,
  class_id         TEXT NOT NULL REFERENCES classes (id)     ON DELETE RESTRICT,
  teacher_id       TEXT NOT NULL REFERENCES users (id)       ON DELETE RESTRICT,
  attempt_number   SMALLINT NOT NULL CHECK (attempt_number > 0),
  content          TEXT NOT NULL DEFAULT '',
  grade            NUMERIC(5, 2) CHECK (grade >= 0),
  status           TEXT NOT NULL CHECK (status IN ('submitted', 'graded', 'returned')),
  submitted_at     TIMESTAMPTZ NOT NULL,

  -- Nam truong examIntegrity giu nguyen la cot rieng le (khong JSONB):
  -- chung co dinh va co truy van thong ke.
  integrity_session_started_at   TIMESTAMPTZ,
  integrity_tab_switch_count     INTEGER NOT NULL DEFAULT 0 CHECK (integrity_tab_switch_count >= 0),
  integrity_focus_loss_count     INTEGER NOT NULL DEFAULT 0 CHECK (integrity_focus_loss_count >= 0),
  integrity_fullscreen_exit_count INTEGER NOT NULL DEFAULT 0 CHECK (integrity_fullscreen_exit_count >= 0),
  integrity_auto_submitted       BOOLEAN NOT NULL DEFAULT false,
  integrity_auto_submit_reason   TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- KHONG dat UNIQUE (assignment_id, student_id, attempt_number).
  -- Do tren production: hoc sinh 9sUfWp5CuOPDIl4XFu6c co attemptNumber
  -- [1,1,3,3,3] tren cung mot bai tap; 4/26 bai nop trung bo ba nay. Tuc
  -- attemptNumber KHONG duoc ung dung cap tang dan mot cach dang tin. Dat
  -- UNIQUE o day thi vua lam fail buoc nap, vua lam ung dung dung ngay lan
  -- hai hoc sinh bam nop gan nhau sau cutover.
  CONSTRAINT submission_auto_reason CHECK (
    integrity_auto_submitted = false OR integrity_auto_submit_reason IS NOT NULL
  )
);

CREATE INDEX submissions_assignment_idx ON submissions (assignment_id, submitted_at DESC);
CREATE INDEX submissions_student_idx    ON submissions (student_id, submitted_at DESC);
CREATE INDEX submissions_attempt_idx    ON submissions (assignment_id, student_id, attempt_number);

COMMENT ON TABLE submissions IS
  'Bo cot studentName (muc 1.7) — lay bang JOIN sang students.';

CREATE TABLE submission_quiz_answers (
  id              TEXT PRIMARY KEY,
  submission_id   TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES assignment_questions (id) ON DELETE RESTRICT,
  selected_option TEXT,

  CONSTRAINT submission_answer_key UNIQUE (submission_id, question_id)
);

CREATE INDEX submission_quiz_answers_question_idx ON submission_quiz_answers (question_id);

-- Bai tap dang cham theo tieu chi (Assignment.assessment). Chua co du lieu
-- production nhung shared/assignmentAssessment.ts da dinh nghia luong.
CREATE TABLE submission_assessment_answers (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  criterion_key  TEXT NOT NULL,
  score          NUMERIC(6, 2),
  comment        TEXT,

  CONSTRAINT submission_assessment_key UNIQUE (submission_id, criterion_key)
);

-- ---------------------------------------------------------------------------
-- knowledge_bank_items
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_bank_items (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT,
  resource_kind      TEXT NOT NULL CHECK (resource_kind IN ('document', 'video', 'audio', 'link')),
  target_type        TEXT NOT NULL CHECK (target_type IN ('grade', 'class', 'global')),
  class_id           TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  grade              SMALLINT CHECK (grade BETWEEN 1 AND 12),
  curriculum_family  TEXT,
  program_name       TEXT,
  unit_number        SMALLINT CHECK (unit_number > 0),

  storage_path       TEXT NOT NULL,
  original_filename  TEXT NOT NULL,
  file_type          TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  file_size          BIGINT NOT NULL CHECK (file_size >= 0),

  download_count     INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_downloaded_at TIMESTAMPTZ,

  uploaded_by        TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- target_type quyet dinh cot nao bat buoc.
  CONSTRAINT knowledge_target_shape CHECK (
    (target_type = 'grade'  AND grade IS NOT NULL) OR
    (target_type = 'class'  AND class_id IS NOT NULL) OR
    (target_type = 'global')
  )
);

CREATE INDEX knowledge_bank_grade_idx ON knowledge_bank_items (grade, unit_number);
CREATE INDEX knowledge_bank_class_idx ON knowledge_bank_items (class_id) WHERE class_id IS NOT NULL;

COMMENT ON TABLE knowledge_bank_items IS
  'Bo cot uploadedByName va className (muc 1.7) — lay bang JOIN.';

-- ---------------------------------------------------------------------------
-- Ba bang cua diem mo 4.5 chua co du lieu
-- ---------------------------------------------------------------------------
-- curriculums, exam_bank, exam_templates: khong co interface trong repo VA
-- khong co document nao tren production (da kiem 2026-08-19, ca ba deu vang
-- mat trong 54 root collection). Khong the suy hinh dang tu du lieu vi khong
-- co du lieu. Tao khung toi thieu, siet kieu khi duong ghi dau tien xuat hien.
CREATE TABLE curriculums (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  grade       SMALLINT CHECK (grade BETWEEN 1 AND 12),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exam_bank (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  grade       SMALLINT CHECK (grade BETWEEN 1 AND 12),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exam_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE exam_bank IS
  'Diem mo 4.5: khong co interface va khong co du lieu production de suy hinh dang. Khung toi thieu, cot data JSONB tam giu phan chua biet.';

SELECT app_attach_touch('assignments');
SELECT app_attach_touch('submissions');
SELECT app_attach_touch('knowledge_bank_items');
SELECT app_attach_touch('curriculums');
SELECT app_attach_touch('exam_bank');
SELECT app_attach_touch('exam_templates');

COMMIT;
