-- 0003_academic.sql
-- Lop, ky hoc, buoi day, ghi danh, diem danh, danh gia.
--
-- Chuan hoa lon nhat cua toan bo dot di tru nam o day: mot `Class` tren
-- Firestore dang mang lan hai loai thuoc tinh — vinh vien (ten, phong, giao
-- vien) va thuoc ve ky dang chay (ngay bat dau, hoc phi, lich tuan) — roi
-- terms[] giu ban sao cua cac ky cu. Tach ra thi "ky hien tai" chi la hang co
-- term_start lon nhat.

BEGIN;

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------
CREATE TABLE classes (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  room                   TEXT NOT NULL DEFAULT '',
  teacher_id             TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'paused', 'archived')),
  grade                  SMALLINT CHECK (grade BETWEEN 1 AND 12),
  salary_per_session     NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (salary_per_session >= 0),
  currency               TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),

  -- Luu vet lop duoc tao bang cach nhap tu lop khac / thang cap len tu lop khac.
  -- Day khong phai ban sao ten de doc cho nhanh (muc 1.7) ma la bang chung ve
  -- goc goc: lop nguon co the doi ten hoac bi xoa sau do.
  import_source_class_id TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  promoted_at            TIMESTAMPTZ,
  promotion_source_class_name   TEXT,
  promotion_source_teacher_name TEXT,
  promotion_note                TEXT,
  promotion_recorded_at         TIMESTAMPTZ,

  archived_at            TIMESTAMPTZ,
  archived_by            TEXT REFERENCES users (id) ON DELETE RESTRICT,
  archive_reason         TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- status='archived' la trang thai vong doi that, khong phai co xoa mem.
  CONSTRAINT classes_archive_pair CHECK (
    (status = 'archived') OR (archived_at IS NULL AND archived_by IS NULL)
  )
);

CREATE INDEX classes_teacher_idx ON classes (teacher_id);
CREATE INDEX classes_status_idx  ON classes (status);

COMMENT ON TABLE classes IS
  'Da chuyen di: terms[] -> class_terms; weeklySessions[] -> class_term_weekly_sessions; holidays[] -> class_holidays; studentCounts{} -> v_class_student_counts; courseClosing{} -> course_closings; startDate/endDate/startTime/daysOfWeek/schedule/tuitionFee/currentCourseId -> class_terms.';

ALTER TABLE students
  ADD CONSTRAINT students_trial_class_fkey FOREIGN KEY (trial_class_id) REFERENCES classes (id) ON DELETE RESTRICT;
ALTER TABLE admissions_history
  ADD CONSTRAINT admissions_history_class_fkey FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT;
ALTER TABLE student_progression_events
  ADD CONSTRAINT student_progression_from_class_fkey FOREIGN KEY (from_class_id) REFERENCES classes (id) ON DELETE RESTRICT,
  ADD CONSTRAINT student_progression_to_class_fkey   FOREIGN KEY (to_class_id)   REFERENCES classes (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- class_terms
-- ---------------------------------------------------------------------------
CREATE TABLE class_terms (
  id                 TEXT PRIMARY KEY,
  class_id           TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,

  -- Dinh danh khoa do nghiep vu dat (UUID). Khong phai khoa chinh.
  course_id          TEXT,
  name               TEXT,

  term_start         DATE NOT NULL,
  term_end           DATE,                     -- NULL = ky dang mo

  tuition_fee        NUMERIC(14, 2) CHECK (tuition_fee >= 0),
  currency           TEXT NOT NULL DEFAULT 'VND' CHECK (currency IN ('VND', 'USD')),

  start_time         TIME,
  days_of_week       SMALLINT[] NOT NULL DEFAULT '{}',

  reset_operation_id TEXT,
  repair_source      TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT class_terms_order CHECK (term_end IS NULL OR term_end >= term_start),
  CONSTRAINT class_terms_days_valid CHECK (
    days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]
  ),
  CONSTRAINT class_terms_class_start_key UNIQUE (class_id, term_start)
);

-- KHONG dat EXCLUDE chong ky chong lan.
--
-- Tai lieu thiet ke de xuat mot rang buoc EXCLUDE USING gist tren
-- (class_id, daterange(term_start, term_end)) de "chan dung lop loi term chong
-- nhau tung gay ra ledger trung". Do tren production 2026-08-19 cho thay
-- BAT BIEN DO KHONG DUNG:
--
--   lop RI6vRY14dJtwLSpdy1Bc (G6 - Mr.Khoa - T7CN)
--     khoa cu:  2026-06-27 .. 2026-08-16   (theo courseClosing cua chinh lop)
--     khoa moi: 2026-08-15 .. 2026-10-04   (theo startDate/endDate cua lop)
--
-- Hai ngay chong nhau (15 va 16/8) la chuyen khoa binh thuong, khong phai loi.
-- Neu dat EXCLUDE thi buoc nap tu choi ban ghi ket khoa co that, va sau cutover
-- ung dung se dung moi lan chuyen khoa gap nhau.
--
-- Thu THAT SU chan ledger trung la UNIQUE (student_id, class_id, term_start)
-- tren course_fee_ledgers — da do: 0/739 vi pham. Con o day,
-- class_terms_class_start_key (UNIQUE class_id, term_start) chan hai ky cung
-- ngay bat dau. Do la muc rang buoc dung voi du lieu that.
--
-- Extension btree_gist van duoc cai o 0001 de sau nay them EXCLUDE khac neu can.

CREATE INDEX class_terms_class_idx     ON class_terms (class_id, term_start DESC);
CREATE INDEX class_terms_range_idx     ON class_terms USING gist (
  class_id, daterange(term_start, term_end, '[]')
);
CREATE INDEX class_terms_course_id_idx ON class_terms (course_id) WHERE course_id IS NOT NULL;
CREATE INDEX class_terms_open_idx      ON class_terms (class_id) WHERE term_end IS NULL;

-- ---------------------------------------------------------------------------
-- class_term_weekly_sessions / class_holidays
-- ---------------------------------------------------------------------------
CREATE TABLE class_term_weekly_sessions (
  id           TEXT PRIMARY KEY,
  term_id      TEXT NOT NULL REFERENCES class_terms (id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=CN
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  room         TEXT,

  CONSTRAINT weekly_session_time_order CHECK (end_time > start_time),
  CONSTRAINT weekly_session_slot_key   UNIQUE (term_id, day_of_week, start_time)
);

CREATE INDEX class_term_weekly_sessions_term_idx ON class_term_weekly_sessions (term_id);

CREATE TABLE class_holidays (
  id            TEXT PRIMARY KEY,
  term_id       TEXT NOT NULL REFERENCES class_terms (id) ON DELETE CASCADE,
  holiday_date  DATE NOT NULL,
  note          TEXT,

  CONSTRAINT class_holiday_key UNIQUE (term_id, holiday_date)
);

-- ---------------------------------------------------------------------------
-- class_sessions  (buoi day that + diem danh giao vien)
-- ---------------------------------------------------------------------------
-- Diem mo 4.3 da chot: 6 cot teacherAttendance* o lai day. Quan he 1-1 that,
-- tach bang chi ton JOIN ma khong mua duoc rang buoc nao.
CREATE TABLE class_sessions (
  id                                TEXT PRIMARY KEY,
  class_id                          TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  term_id                           TEXT REFERENCES class_terms (id) ON DELETE RESTRICT,
  session_date                      DATE NOT NULL,
  teacher_id                        TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status                            TEXT NOT NULL DEFAULT 'taught'
                                    CHECK (status IN ('taught', 'cancelled', 'holiday')),
  salary_per_session                NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (salary_per_session >= 0),

  teacher_attendance_status         TEXT CHECK (teacher_attendance_status IN ('present', 'absent', 'substituted')),
  teacher_attendance_marked_at      TIMESTAMPTZ,
  teacher_attendance_marked_by      TEXT,
  teacher_attendance_marked_by_role TEXT CHECK (teacher_attendance_marked_by_role IN ('admin', 'office')),
  teacher_attendance_note           TEXT,
  -- Phan biet buoi do nguoi diem danh voi buoi do migration dung lai —
  -- thu ma audit luong can.
  teacher_attendance_source         TEXT CHECK (teacher_attendance_source IN ('office_admin', 'promotion_backfill')),

  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT class_sessions_date_key UNIQUE (class_id, session_date),
  -- Da diem danh thi phai biet ai diem va luc nao.
  CONSTRAINT teacher_attendance_complete CHECK (
    teacher_attendance_status IS NULL
    OR (teacher_attendance_marked_at IS NOT NULL AND teacher_attendance_marked_by IS NOT NULL)
  )
);

CREATE INDEX class_sessions_class_date_idx ON class_sessions (class_id, session_date DESC);
CREATE INDEX class_sessions_teacher_idx    ON class_sessions (teacher_id, session_date DESC);
CREATE INDEX class_sessions_term_idx       ON class_sessions (term_id) WHERE term_id IS NOT NULL;

COMMENT ON CONSTRAINT class_sessions_date_key ON class_sessions IS
  'Production co dung 1 vi pham: lop Z8oeO9IN5H3lsV6IOAoH ngay 2026-05-13 co hai doc (5WiJgcjDQSnpQbXfs3j4 va Z8oeO9IN5H3lsV6IOAoH_2026-05-13). Phai gop truoc khi nap.';

-- ---------------------------------------------------------------------------
-- student_course_enrollments  — bang ban le
-- ---------------------------------------------------------------------------
-- Moi bat bien trong assertValidStudentCourseEnrollment() chuyen thanh CHECK.
-- Hom nay chung chi duoc kiem o tang ung dung, nen bat ky script nao ghi thang
-- deu di vong qua — va da di vong, nhieu lan. Dat xuong DB thi khong lach duoc.
-- Do tren 823 doc production: ca 4 CHECK deu 0 vi pham.
CREATE TABLE student_course_enrollments (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL REFERENCES students (id)     ON DELETE RESTRICT,
  class_id          TEXT NOT NULL REFERENCES classes (id)      ON DELETE RESTRICT,
  term_id           TEXT          REFERENCES class_terms (id)  ON DELETE RESTRICT,
  term_start        DATE NOT NULL,
  term_end          DATE,
  status            TEXT NOT NULL
                    CHECK (status IN ('trial', 'active', 'on_leave',
                                      'completed', 'transferred', 'dropped')),
  joined_at         DATE NOT NULL,
  ended_at          DATE,
  status_reason     TEXT,
  source            TEXT NOT NULL CHECK (source IN ('system', 'backfill', 'manual')),
  confidence        TEXT NOT NULL CHECK (confidence IN ('confirmed', 'inferred')),
  status_changed_at TIMESTAMPTZ NOT NULL,
  status_changed_by TEXT NOT NULL,
  confirmed_at      TIMESTAMPTZ,
  confirmed_by      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT enrollment_term_key UNIQUE (student_id, class_id, term_start),

  CONSTRAINT enrollment_term_order CHECK (term_end IS NULL OR term_end >= term_start),

  CONSTRAINT enrollment_joined_in_term CHECK (
    joined_at >= term_start AND (term_end IS NULL OR joined_at <= term_end)
  ),

  CONSTRAINT enrollment_open_has_no_end CHECK (
    (status IN ('trial', 'active', 'on_leave') AND ended_at IS NULL)
    OR
    (status IN ('completed', 'transferred', 'dropped')
     AND ended_at IS NOT NULL AND ended_at >= joined_at)
  ),

  CONSTRAINT enrollment_confirm_pair CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL))
);

CREATE INDEX enrollment_student_idx ON student_course_enrollments (student_id, term_start DESC);
CREATE INDEX enrollment_class_idx   ON student_course_enrollments (class_id, term_start DESC);
CREATE INDEX enrollment_open_idx    ON student_course_enrollments (student_id)
  WHERE status IN ('trial', 'active', 'on_leave');

COMMENT ON TABLE student_course_enrollments IS
  'Doc ID cu tren Firestore la base64 cua bo ba [studentId, classId, termStart]. Giu nguyen chuoi do lam khoa chinh (khong phai anh xa lai) nhung tinh duy nhat gio do enrollment_term_key lo, khong do cach dat ten ID. Ban ghi moi sau cutover dung ID tu shared/idGenerator.ts.';

-- ---------------------------------------------------------------------------
-- student_leave_periods
-- ---------------------------------------------------------------------------
-- Tu students.leavePeriods[]. Production: 28 hang, `until` luon NULL
-- (nghi chua co ngay quay lai).
CREATE TABLE student_leave_periods (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id    TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  leave_from  DATE NOT NULL,
  leave_until DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT leave_period_order CHECK (leave_until IS NULL OR leave_until >= leave_from)
);

CREATE INDEX student_leave_periods_student_idx ON student_leave_periods (student_id, leave_from DESC);

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
CREATE TABLE attendance (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id       TEXT NOT NULL REFERENCES classes (id)  ON DELETE RESTRICT,
  -- Gan buoi diem danh voi dung ky, xoa nhu cau suy nguoc ky tu ngay.
  enrollment_id  TEXT REFERENCES student_course_enrollments (id) ON DELETE RESTRICT,
  session_id     TEXT REFERENCES class_sessions (id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  teacher_id     TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  permission     BOOLEAN NOT NULL DEFAULT false,   -- vang co phep
  minutes_late   INTEGER CHECK (minutes_late >= 0),

  -- Huy mot lan diem danh la trang thai nghiep vu (van phai luu vet ai huy),
  -- khong phai xoa mem ban ghi.
  is_voided      BOOLEAN NOT NULL DEFAULT false,
  void_reason    TEXT,
  voided_at      TIMESTAMPTZ,
  voided_by      TEXT REFERENCES users (id) ON DELETE RESTRICT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT attendance_day_key UNIQUE (student_id, class_id, attendance_date),
  CONSTRAINT attendance_void_complete CHECK (
    is_voided = false OR (voided_at IS NOT NULL AND voided_by IS NOT NULL)
  )
);

CREATE INDEX attendance_class_date_idx   ON attendance (class_id, attendance_date DESC);
CREATE INDEX attendance_student_date_idx ON attendance (student_id, attendance_date DESC);
CREATE INDEX attendance_live_idx         ON attendance (class_id, attendance_date) WHERE is_voided = false;

-- ---------------------------------------------------------------------------
-- evaluations
-- ---------------------------------------------------------------------------
CREATE TABLE evaluations (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id            TEXT NOT NULL REFERENCES classes (id)  ON DELETE RESTRICT,
  term_id             TEXT REFERENCES class_terms (id) ON DELETE RESTRICT,
  teacher_id          TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

  evaluation_type     TEXT NOT NULL DEFAULT 'final' CHECK (evaluation_type IN ('midterm', 'final')),
  evaluated_at        TIMESTAMPTZ NOT NULL,
  term_start          DATE,
  term_end            DATE,

  -- Nam diem thanh phan la tap co dinh va co truy van thong ke, nen la cot
  -- that chu khong phai JSONB.
  score_attendance    SMALLINT NOT NULL CHECK (score_attendance    BETWEEN 0 AND 100),
  score_behavior      SMALLINT NOT NULL CHECK (score_behavior      BETWEEN 0 AND 100),
  score_effort        SMALLINT NOT NULL CHECK (score_effort        BETWEEN 0 AND 100),
  score_homework      SMALLINT NOT NULL CHECK (score_homework      BETWEEN 0 AND 100),
  score_pronunciation SMALLINT NOT NULL CHECK (score_pronunciation BETWEEN 0 AND 100),
  final_score         SMALLINT NOT NULL CHECK (final_score BETWEEN 0 AND 100),
  total_score         SMALLINT NOT NULL CHECK (total_score BETWEEN 0 AND 100),

  rank                TEXT CHECK (rank IN ('first', 'second', 'none')),
  positive_points     TEXT[] NOT NULL DEFAULT '{}',
  improvement_points  TEXT NOT NULL DEFAULT '',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT evaluation_term_order CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start),
  -- Mot hoc sinh chi co mot ban danh gia cuoi ky cho moi ky cua moi lop.
  CONSTRAINT evaluation_term_key UNIQUE (student_id, class_id, term_start, evaluation_type)
);

CREATE INDEX evaluations_class_idx   ON evaluations (class_id, evaluated_at DESC);
CREATE INDEX evaluations_student_idx ON evaluations (student_id, evaluated_at DESC);
CREATE INDEX evaluations_term_idx    ON evaluations (term_id) WHERE term_id IS NOT NULL;

COMMENT ON TABLE evaluations IS
  'Bo isDeleted/deletedAt/deletedBy/deletionReason (4 doc production dang bat). Ban danh gia bi xoa khong nap; ai xoa cai gi nam o audit_logs. Truong termId cua Firestore co 17 doc mang gia tri canh chung "current" — buoc nap phai phan giai thanh term_id that hoac NULL.';

-- ---------------------------------------------------------------------------
-- daily_reports
-- ---------------------------------------------------------------------------
CREATE TABLE daily_reports (
  id               TEXT PRIMARY KEY,
  class_id         TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  teacher_id       TEXT NOT NULL REFERENCES users (id)   ON DELETE RESTRICT,
  report_date      DATE NOT NULL,
  general_comment  TEXT NOT NULL DEFAULT '',
  additional_notes TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT daily_report_key UNIQUE (class_id, report_date)
);

-- ---------------------------------------------------------------------------
-- substitute_requests
-- ---------------------------------------------------------------------------
-- Khong co doc nao tren production nhung code van ghi. Bo cac cot *Name
-- (requestingTeacherName, substituteTeacherName, className) theo muc 1.7 —
-- API van tra ve chung, lay bang JOIN.
CREATE TABLE substitute_requests (
  id                     TEXT PRIMARY KEY,
  class_id               TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  session_id             TEXT REFERENCES class_sessions (id) ON DELETE RESTRICT,
  requesting_teacher_id  TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  substitute_teacher_id  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  session_date           DATE NOT NULL,
  reason                 TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  responded_at           TIMESTAMPTZ,
  responded_by           TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT substitute_response_pair CHECK ((responded_at IS NULL) = (responded_by IS NULL)),
  CONSTRAINT substitute_accepted_has_teacher CHECK (
    status <> 'accepted' OR substitute_teacher_id IS NOT NULL
  )
);

CREATE INDEX substitute_requests_class_idx  ON substitute_requests (class_id, session_date DESC);
CREATE INDEX substitute_requests_status_idx ON substitute_requests (status) WHERE status = 'pending';

SELECT app_attach_touch('classes');
SELECT app_attach_touch('class_terms');
SELECT app_attach_touch('class_sessions');
SELECT app_attach_touch('student_course_enrollments');
SELECT app_attach_touch('attendance');
SELECT app_attach_touch('evaluations');
SELECT app_attach_touch('daily_reports');
SELECT app_attach_touch('substitute_requests');

COMMIT;
