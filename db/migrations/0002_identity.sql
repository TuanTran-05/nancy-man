-- 0002_identity.sql
-- Danh tinh va truy cap.
--
-- Thu tu tao: students truoc users, vi users.student_id tro sang students.

BEGIN;

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
-- SUA SO VOI TAI LIEU THIET KE (bang chung do 2026-08-19):
--   students.code co gia tri tren 2/802 doc; students.studentId khop
--   /^HS\d{6}$/ tren 802/802 va trung khop 60/60 voi doc id cua
--   student_code_registry. Tuc truong mang ma dang nhap la `studentId`,
--   khong phai `code`. Tai lieu anh xa nguoc: no coi `studentId` la
--   school_student_id. Bang duoi lay `code` TU `studentId` cua Firestore.
--   Khong co truong "ma hoc sinh o truong pho thong" nao ton tai trong du lieu.
CREATE TABLE students (
  id                        TEXT PRIMARY KEY,

  -- Ma dang nhap, vd 'HS260847'. Nguon: Firestore students.studentId
  code                      TEXT NOT NULL,
  -- Cot sinh: khong the lech khoi `code` vi khong ai ghi truc tiep duoc.
  -- UNIQUE o day la thu chan 59 ma trung tan goc.
  -- Do tren production: 58 ma trung, TAT CA deu la cap "ho so con song +
  -- ho so da nghi huu". Chi tinh ho so con song thi 0/742 trung.
  code_normalized           TEXT GENERATED ALWAYS AS (app_normalize_code(code)) STORED,

  name                      TEXT NOT NULL,
  -- Phuc vu tim kiem; thay cho accounting_student_summaries.searchTokens[]
  -- (mang toi 28 phan tu phai duy tri bang tay).
  name_normalized           TEXT GENERATED ALWAYS AS (app_normalize_text(name)) STORED,

  dob                       DATE,
  contact                   TEXT,
  gender                    TEXT CHECK (gender IN ('male', 'female', 'other')),
  grade                     SMALLINT CHECK (grade BETWEEN 1 AND 12),

  student_lifecycle         TEXT NOT NULL DEFAULT 'enrolled'
                            CHECK (student_lifecycle IN ('pending', 'lead', 'trial', 'enrolled', 'archived')),

  -- Tuyen sinh. Production chi co 1 doc dung nhom nay, nhung code duong
  -- tuyen sinh van ghi, nen giu cot that.
  admission_status          TEXT CHECK (admission_status IN ('pending', 'trial', 'accepted', 'rejected')),
  admitted_at               TIMESTAMPTZ,
  admitted_by               TEXT,
  enrollment_date           DATE,

  -- Hoc thu
  trial_class_id            TEXT,
  trial_teacher_id          TEXT,
  trial_started_at          TIMESTAMPTZ,
  trial_session_count       INTEGER NOT NULL DEFAULT 0 CHECK (trial_session_count >= 0),
  trial_required_sessions   INTEGER CHECK (trial_required_sessions > 0),
  trial_review_status       TEXT CHECK (trial_review_status IN
                              ('pending_sessions', 'pending_teacher_review', 'accepted', 'rejected')),

  -- Chi giu duong dan Storage. Truong faceImage cua Firestore dai toi 123 ky tu
  -- (la path chu khong phai base64 nhu tai lieu lo ngai) va trung noi dung voi
  -- faceImageStoragePath, nen gop lam mot.
  face_image_storage_path   TEXT,

  -- Thu hoi quyen dang nhap. KHONG phai xoa mem.
  is_revoked                BOOLEAN NOT NULL DEFAULT false,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT students_code_shape       CHECK (btrim(code) <> ''),
  CONSTRAINT students_admitted_pair    CHECK ((admitted_at IS NULL) = (admitted_by IS NULL)),
  CONSTRAINT students_trial_pair       CHECK ((trial_class_id IS NULL) OR (trial_started_at IS NOT NULL))
);

CREATE UNIQUE INDEX students_code_normalized_key ON students (code_normalized);
CREATE INDEX students_name_trgm_idx  ON students USING gin (name_normalized gin_trgm_ops);
CREATE INDEX students_lifecycle_idx  ON students (student_lifecycle);
CREATE INDEX students_dob_idx        ON students (dob);
CREATE INDEX students_contact_idx    ON students (contact);

COMMENT ON COLUMN students.code IS
  'Ma dang nhap HSxxxxxx. Nguon di tru: Firestore students.studentId (KHONG phai students.code, truong do rong tren 800/802 doc).';
COMMENT ON TABLE students IS
  'Khong co deleted_at. 60 ho so nghi huu tren Firestore chi con 4 tham chieu tro toi (1 enrollment, 1 course_closing_record, 2 accounting summary) nen khong port; xem db/README.md muc "Ho so nghi huu".';

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                     TEXT PRIMARY KEY,          -- uid Firebase Auth, giu nguyen
  email                  TEXT,                      -- NULL cho tai khoan hoc sinh/phu huynh (73/117 doc khong co email)
  display_name           TEXT NOT NULL,
  bio                    TEXT,
  role                   TEXT NOT NULL
                         CHECK (role IN ('teacher', 'student', 'parent', 'admin', 'accounting', 'office')),
  phone                  TEXT,                      -- so Zalo OA
  student_id             TEXT REFERENCES students (id) ON DELETE RESTRICT,
  force_password_change  BOOLEAN NOT NULL DEFAULT false,
  is_revoked             BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Rang buoc nay hom nay chi song trong code. Production co dung 1 vi pham:
  -- tai khoan 'loadtest-student-001' (role student, khong studentId).
  CONSTRAINT users_student_link CHECK (
    role NOT IN ('student', 'parent') OR student_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_role_idx       ON users (role);
CREATE INDEX users_student_id_idx ON users (student_id);
CREATE INDEX users_phone_idx      ON users (phone) WHERE phone IS NOT NULL;

COMMENT ON TABLE users IS
  'Da bo: classId, teacherId, enrollmentStatus, faceImage (ban sao tu students); blockedTeacher, blockedAt (ban sao thu ba cua staff_email_access).';

ALTER TABLE students
  ADD CONSTRAINT students_admitted_by_fkey    FOREIGN KEY (admitted_by)     REFERENCES users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT students_trial_teacher_fkey  FOREIGN KEY (trial_teacher_id) REFERENCES users (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- student_auth_credentials
-- ---------------------------------------------------------------------------
-- Tach khoi students de bam mat khau khong di kem moi truy van roster.
-- Luu y thuc te: production chi co 2 hang, va ca hai chi chua mat khau phu
-- huynh. Khong hoc sinh nao dang co bam mat khau rieng. Tai lieu thiet ke noi
-- bang nay "khien hoc sinh va phu huynh khong phai dat lai mat khau khi
-- cutover" — dung, nhung pham vi that la 2 tai khoan, khong phai toan bo.
CREATE TABLE student_auth_credentials (
  student_id                     TEXT PRIMARY KEY REFERENCES students (id) ON DELETE CASCADE,

  student_password_hash          TEXT,
  student_password_salt          TEXT,
  student_password_version       SMALLINT CHECK (student_password_version IN (1, 2)),
  student_force_password_change  BOOLEAN NOT NULL DEFAULT false,

  parent_password_hash           TEXT,
  parent_password_salt           TEXT,
  parent_password_version        SMALLINT CHECK (parent_password_version IN (1, 2)),
  parent_force_password_change   BOOLEAN NOT NULL DEFAULT false,

  migrated_at                    TIMESTAMPTZ,
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Bam va muoi phai di cung nhau, neu khong thi khong xac thuc noi.
  CONSTRAINT student_secret_complete CHECK (
    num_nulls(student_password_hash, student_password_salt) IN (0, 2)
  ),
  CONSTRAINT parent_secret_complete CHECK (
    num_nulls(parent_password_hash, parent_password_salt) IN (0, 2)
  )
);

COMMENT ON COLUMN student_auth_credentials.student_password_version IS
  '1 = SHA-256 legacy, 2 = PBKDF2. Bam do code tu sinh nen di thang sang Postgres, khong ai phai dat lai mat khau.';

-- ---------------------------------------------------------------------------
-- staff_email_access  (+ hai view mang ten cu)
-- ---------------------------------------------------------------------------
-- Gop allowed_teachers + blocked_teachers + config/allowedStaff thanh mot bang.
-- Ly do (da chot 2026-08-18): chan/bo chan hom nay la hai lenh await roi nhau
-- khong transaction (staffAccountManagement.ts:518-522 va :572-576), nen mot
-- email co the nam o ca hai danh sach hoac khong o dau. Login phai phan xu bang
-- luat uu tien chinh vi the. Mot bang co cot status khien mau thuan do khong
-- bieu dien noi.
--
-- Do production: allowed_teachers co 29 doc, blocked_teachers KHONG ton tai
-- (0 doc). Nen bang nay hien chi co hang 'allowed'.
CREATE TABLE staff_email_access (
  email           TEXT PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('allowed', 'blocked')),
  role            TEXT CHECK (role IN ('teacher', 'admin', 'accounting', 'office')),
  added_at        TIMESTAMPTZ,
  added_by_admin  BOOLEAN NOT NULL DEFAULT false,
  blocked_at      TIMESTAMPTZ,
  blocked_by      TEXT REFERENCES users (id) ON DELETE RESTRICT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT allowed_needs_role  CHECK (status = 'blocked' OR role IS NOT NULL),
  CONSTRAINT blocked_needs_time  CHECK (status = 'allowed' OR blocked_at IS NOT NULL),
  CONSTRAINT email_is_lowercase  CHECK (email = lower(btrim(email)))
);

CREATE VIEW allowed_teachers AS
  SELECT email, role, added_at, added_by_admin
  FROM staff_email_access
  WHERE status = 'allowed';

CREATE VIEW blocked_teachers AS
  SELECT email, blocked_at, blocked_by
  FROM staff_email_access
  WHERE status = 'blocked';

COMMENT ON VIEW allowed_teachers IS
  'Giu ten cu de UI admin va repository khong phai sua. Chan/bo chan gio la mot cau UPDATE tren staff_email_access.';

-- ---------------------------------------------------------------------------
-- Yeu cau tai khoan / doi mat khau
-- ---------------------------------------------------------------------------
CREATE TABLE staff_account_requests (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  email        TEXT,
  role         TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'accounting', 'office')),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  reviewed_at  TIMESTAMPTZ,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT staff_request_review_pair CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);

CREATE INDEX staff_account_requests_status_idx ON staff_account_requests (status, created_at DESC);

-- Bo cot studentName (JOIN lay tu students), theo muc 1.7 cua tai lieu.
CREATE TABLE password_reset_requests (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  phone_number  TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT 'student' CHECK (scope IN ('student', 'parent')),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT password_reset_resolution_pair CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);

CREATE INDEX password_reset_requests_student_idx ON password_reset_requests (student_id, requested_at DESC);
CREATE INDEX password_reset_requests_status_idx  ON password_reset_requests (status) WHERE status = 'pending';

CREATE TABLE staff_password_reset_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  email         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX staff_password_reset_status_idx ON staff_password_reset_requests (status) WHERE status = 'pending';

CREATE TABLE teacher_registration_requests (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  display_name TEXT,
  phone        TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- admissions_history
-- ---------------------------------------------------------------------------
-- Collection nay co that tren production (12 doc) nhung tai lieu thiet ke
-- khong nhac toi. Day la nhat ky duong tuyen sinh.
CREATE TABLE admissions_history (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id    TEXT,                       -- FK them o 0003 sau khi co bang classes
  teacher_id  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  action      TEXT NOT NULL CHECK (action IN ('added_to_waitlist', 'class_changed', 'admitted', 'rejected')),
  actor_id    TEXT REFERENCES users (id) ON DELETE RESTRICT,
  actor_role  TEXT,
  note        TEXT,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admissions_history_student_idx ON admissions_history (student_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- student_progression_events
-- ---------------------------------------------------------------------------
-- Khong co interface trong repo va khong co doc nao tren production
-- (diem mo 4.5 cua tai lieu). Tao bang toi thieu: cot that cho nhung gi
-- studentProgression.ts thuc su doc, phan con lai vao JSONB, siet sau khi
-- co du lieu that.
CREATE TABLE student_progression_events (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  from_class_id TEXT,
  to_class_id   TEXT,
  event_type    TEXT NOT NULL,
  operation_id  TEXT,
  actor_id      TEXT REFERENCES users (id) ON DELETE RESTRICT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX student_progression_events_student_idx ON student_progression_events (student_id, created_at DESC);
CREATE INDEX student_progression_events_op_idx      ON student_progression_events (operation_id) WHERE operation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Cau hinh he thong
-- ---------------------------------------------------------------------------
-- Tu Firestore system_settings (2 doc: 'google_sheets', 'holidays') va
-- _maintenance (83 doc). Hai cai nay hinh dang khac han nhau theo tung key nen
-- JSONB la dung cho, khong phai luoi bieng.
CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_flags (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  ran_at      TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE maintenance_flags IS
  'Tu Firestore _maintenance (83 doc): co chay cron, ket qua digest, trang thai lien ket Zalo. Hinh dang khac nhau theo key nen luu JSONB.';

SELECT app_attach_touch('students');
SELECT app_attach_touch('users');
SELECT app_attach_touch('student_auth_credentials');
SELECT app_attach_touch('staff_email_access');
SELECT app_attach_touch('staff_account_requests');
SELECT app_attach_touch('password_reset_requests');
SELECT app_attach_touch('staff_password_reset_requests');
SELECT app_attach_touch('teacher_registration_requests');
SELECT app_attach_touch('system_settings');
SELECT app_attach_touch('maintenance_flags');

COMMIT;
