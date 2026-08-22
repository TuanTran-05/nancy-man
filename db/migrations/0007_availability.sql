-- 0007_availability.sql
-- Lich ranh giao vien.
--
-- selectionKeys[] la mang khoa phai sinh chi de truy van duoc tren Firestore
-- (production: toi 22 phan tu, luon trung noi dung voi selections[]).
-- XOA. Thay bang index tren bang con.

BEGIN;

-- Danh muc khung gio. Tren Firestore day chi la cac chuoi 'A1','A2','B1','B2',
-- 'C','D' rai rac trong selections[], khong co noi nao dinh nghia chung.
CREATE TABLE teacher_availability_slots (
  slot_id     TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  start_time  TIME,
  end_time    TIME,
  position    SMALLINT NOT NULL,

  CONSTRAINT availability_slot_time_order CHECK (
    end_time IS NULL OR start_time IS NULL OR end_time > start_time
  ),
  CONSTRAINT availability_slot_position_key UNIQUE (position)
);

CREATE TABLE teacher_availability_profiles (
  id          TEXT PRIMARY KEY,
  teacher_id  TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by  TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by  TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Mot giao vien mot ho so. Doc ID cu chinh la teacherId, nen luat nay von
  -- dung nhung khong duoc phat bieu o dau ca.
  CONSTRAINT availability_profile_teacher_key UNIQUE (teacher_id)
);

COMMENT ON TABLE teacher_availability_profiles IS
  'Bo cot teacherName (muc 1.7) va selectionKeys[] (mang phai sinh).';

CREATE TABLE teacher_availability_profile_selections (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES teacher_availability_profiles (id) ON DELETE CASCADE,
  day_key     TEXT NOT NULL CHECK (day_key IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  slot_id     TEXT NOT NULL REFERENCES teacher_availability_slots (slot_id) ON DELETE RESTRICT,

  CONSTRAINT availability_selection_key UNIQUE (profile_id, day_key, slot_id)
);

CREATE INDEX availability_selection_slot_idx ON teacher_availability_profile_selections (day_key, slot_id);

CREATE TABLE teacher_availability_change_requests (
  id           TEXT PRIMARY KEY,
  teacher_id   TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  profile_id   TEXT REFERENCES teacher_availability_profiles (id) ON DELETE RESTRICT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason       TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT availability_request_review_pair CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);

CREATE INDEX availability_requests_status_idx ON teacher_availability_change_requests (status)
  WHERE status = 'pending';

CREATE TABLE teacher_availability_change_request_selections (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES teacher_availability_change_requests (id) ON DELETE CASCADE,
  day_key     TEXT NOT NULL CHECK (day_key IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  slot_id     TEXT NOT NULL REFERENCES teacher_availability_slots (slot_id) ON DELETE RESTRICT,

  CONSTRAINT availability_request_selection_key UNIQUE (request_id, day_key, slot_id)
);

-- Sau khung gio dang duoc dung tren production. Nap truoc de FK cua
-- selections co cho tro toi.
INSERT INTO teacher_availability_slots (slot_id, label, position) VALUES
  ('A1', 'A1', 1),
  ('A2', 'A2', 2),
  ('B1', 'B1', 3),
  ('B2', 'B2', 4),
  ('C',  'C',  5),
  ('D',  'D',  6);

SELECT app_attach_touch('teacher_availability_profiles');
SELECT app_attach_touch('teacher_availability_change_requests');

COMMIT;
