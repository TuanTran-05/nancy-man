-- 0008_notifications_zalo.sql
-- Thong bao trong app, thong bao Zalo OA, va bot Zalo cho nhan vien.

BEGIN;

-- ---------------------------------------------------------------------------
-- notifications  (thong bao trong app cho hoc sinh)
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id    TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  teacher_id  TEXT REFERENCES users (id) ON DELETE RESTRICT,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_student_idx ON notifications (student_id, created_at DESC);
CREATE INDEX notifications_unread_idx  ON notifications (student_id) WHERE is_read = false;

-- ---------------------------------------------------------------------------
-- admin_notifications
-- ---------------------------------------------------------------------------
CREATE TABLE admin_notifications (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN
                  ('zalo_failure_digest', 'payment_needs_review', 'payment_failed', 'system_alert')),
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  is_read       BOOLEAN NOT NULL DEFAULT false,
  -- So luong that bai theo tung loai. Day la ket qua tong hop cua mot lan chay
  -- digest, khong phai cache cua bang khac, nen JSONB dung cho.
  counts_by_type JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_id    TEXT,
  order_code    BIGINT,
  amount        NUMERIC(14, 2),
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_notifications_unread_idx ON admin_notifications (created_at DESC) WHERE is_read = false;

-- Tu admin_notifications.sampleFailures[] (mang toi 10 phan tu).
CREATE TABLE admin_notification_failures (
  id                     TEXT PRIMARY KEY,
  admin_notification_id  TEXT NOT NULL REFERENCES admin_notifications (id) ON DELETE CASCADE,
  zalo_notification_id   TEXT,
  student_id             TEXT REFERENCES students (id) ON DELETE RESTRICT,
  phone                  TEXT,
  failure_type           TEXT NOT NULL,
  error_message          TEXT,
  occurred_at            TIMESTAMPTZ NOT NULL
);

CREATE INDEX admin_notification_failures_parent_idx ON admin_notification_failures (admin_notification_id);

-- ---------------------------------------------------------------------------
-- zalo_notifications
-- ---------------------------------------------------------------------------
-- 1271 doc production, 92 duong truong — nhieu truong chi xuat hien duoi 1%
-- va thuoc ve mot loai thong bao duy nhat. Cot that cho nhung gi MOI loai deu
-- co va co truy van; phan rieng theo loai vao payload_snapshot.
CREATE TABLE zalo_notifications (
  id                    TEXT PRIMARY KEY,
  zalo_message_id       TEXT NOT NULL,
  type                  TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  phone                 TEXT NOT NULL,

  student_id            TEXT REFERENCES students (id) ON DELETE RESTRICT,
  class_id              TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  term_id               TEXT REFERENCES class_terms (id) ON DELETE RESTRICT,
  teacher_id            TEXT REFERENCES users (id) ON DELETE RESTRICT,
  evaluation_id         TEXT REFERENCES evaluations (id) ON DELETE RESTRICT,

  notification_date     DATE,
  amount                NUMERIC(14, 2) CHECK (amount >= 0),
  template_id           TEXT,
  recipient_role        TEXT,

  error_message         TEXT NOT NULL DEFAULT '',
  provider_error_code   INTEGER,
  provider_message_id   TEXT,

  sent_at               TIMESTAMPTZ,
  sent_by               TEXT REFERENCES users (id) ON DELETE RESTRICT,
  delivered_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  resend_by             TEXT,

  -- Anh chup payload gui di, phuc vu doi chieu khi khach hang khieu nai.
  payload_snapshot      JSONB,
  snapshot_checksum     TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT zalo_notification_sent_has_time CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT zalo_notification_failed_has_error CHECK (status <> 'failed' OR error_message <> '')
);

CREATE INDEX zalo_notifications_student_idx ON zalo_notifications (student_id, created_at DESC);
CREATE INDEX zalo_notifications_class_idx   ON zalo_notifications (class_id, notification_date DESC);
CREATE INDEX zalo_notifications_failed_idx  ON zalo_notifications (created_at DESC) WHERE status = 'failed';
CREATE INDEX zalo_notifications_type_idx    ON zalo_notifications (type, created_at DESC);

COMMENT ON TABLE zalo_notifications IS
  'Bo cot studentName, className, studentCode (muc 1.7) — JOIN sang students/classes.';

ALTER TABLE admin_notification_failures
  ADD CONSTRAINT admin_notification_failures_zalo_fkey
  FOREIGN KEY (zalo_notification_id) REFERENCES zalo_notifications (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- Bot Zalo cho nhan vien
-- ---------------------------------------------------------------------------
CREATE TABLE zalo_bot_links (
  id                  TEXT PRIMARY KEY,
  staff_id            TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  chat_id             TEXT NOT NULL,
  chat_id_hash        TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'accounting', 'office')),
  display_name        TEXT,
  status              TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  confirmation_status TEXT CHECK (confirmation_status IN ('pending', 'confirmed', 'failed')),
  linked_method       TEXT CHECK (linked_method IN ('self', 'admin')),
  linked_by           TEXT REFERENCES users (id) ON DELETE RESTRICT,
  linked_at           TIMESTAMPTZ NOT NULL,
  last_seen_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Mot nhan vien mot chat, mot chat mot nhan vien. Hom nay luat nay chi nam
  -- trong code.
  CONSTRAINT zalo_bot_link_staff_key    UNIQUE (staff_id),
  CONSTRAINT zalo_bot_link_chat_key     UNIQUE (chat_id_hash)
);

CREATE TABLE zalo_bot_link_codes (
  id                      TEXT PRIMARY KEY,   -- hash cua ma, khong luu ma thuan
  staff_id                TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role                    TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'accounting', 'office')),
  display_name            TEXT,
  issued_at               TIMESTAMPTZ NOT NULL,
  expires_at              TIMESTAMPTZ NOT NULL,
  consumed_at             TIMESTAMPTZ,
  consumed_by_chat_id_hash TEXT,

  CONSTRAINT link_code_expiry_after_issue CHECK (expires_at > issued_at),
  CONSTRAINT link_code_consumed_pair CHECK ((consumed_at IS NULL) = (consumed_by_chat_id_hash IS NULL))
);

CREATE INDEX zalo_bot_link_codes_staff_idx ON zalo_bot_link_codes (staff_id, issued_at DESC);
CREATE INDEX zalo_bot_link_codes_live_idx  ON zalo_bot_link_codes (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE zalo_bot_chat_claims (
  id           TEXT PRIMARY KEY,   -- chat_id_hash
  staff_id     TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  claimed_at   TIMESTAMPTZ NOT NULL,
  released     BOOLEAN NOT NULL DEFAULT false,
  released_at  TIMESTAMPTZ,

  CONSTRAINT chat_claim_release_pair CHECK ((released = false) = (released_at IS NULL))
);

CREATE TABLE zalo_bot_chat_sessions (
  staff_id        TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  last_intent     TEXT,
  last_class_id   TEXT REFERENCES classes (id) ON DELETE RESTRICT,
  last_asked_at   TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,

  CONSTRAINT chat_session_expiry_after_ask CHECK (expires_at > last_asked_at)
);

COMMENT ON TABLE zalo_bot_chat_sessions IS
  'Bo cot lastClassName (muc 1.7) — JOIN sang classes. Tren production ca 5 hang deu co lastClassId NULL.';

CREATE TABLE zalo_bot_messages (
  id                  TEXT PRIMARY KEY,
  staff_id            TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  chat_id_hash        TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'accounting', 'office')),
  message_type        TEXT NOT NULL CHECK (message_type IN
                        ('daily_digest', 'chat_reply', 'link_confirmation')),
  digest_date         DATE NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  content_snapshot    TEXT,
  provider_message_id TEXT,
  attempts            SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at     TIMESTAMPTZ,
  error_code          TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Doc ID cu sinh tu makeZaloBotDailyMessageId(date, staffId) de chong gui trung
-- digest. Thay bang khoa thay the + UNIQUE — cung tac dung, dung quy uoc 1.1.
-- Chi ap cho digest: chat_reply thi mot nguoi mot ngay co nhieu tin.
CREATE UNIQUE INDEX zalo_bot_daily_digest_key
  ON zalo_bot_messages (staff_id, digest_date, message_type)
  WHERE message_type = 'daily_digest';

CREATE INDEX zalo_bot_messages_staff_idx ON zalo_bot_messages (staff_id, digest_date DESC);

-- ---------------------------------------------------------------------------
-- Gui hang loat qua Zalo
-- ---------------------------------------------------------------------------
CREATE TABLE zalo_bulk_jobs (
  id              TEXT PRIMARY KEY,
  class_id        TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  course_id       TEXT,
  type            TEXT NOT NULL CHECK (type IN ('evaluation', 'rank_achievement', 'tuition_notice')),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'partial_failure', 'failed')),
  requested_count INTEGER NOT NULL CHECK (requested_count >= 0),
  valid_count     INTEGER NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  success_count   INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count   INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_by      TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bulk_job_counts_add_up CHECK (success_count + failure_count <= valid_count),
  CONSTRAINT bulk_job_valid_within_requested CHECK (valid_count <= requested_count)
);

CREATE INDEX zalo_bulk_jobs_class_idx ON zalo_bulk_jobs (class_id, created_at DESC);

COMMENT ON TABLE zalo_bulk_jobs IS
  'Bo cot createdByName (muc 1.7) va items[] (da co bang con zalo_bulk_job_items).';

CREATE TABLE zalo_bulk_job_items (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES zalo_bulk_jobs (id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id    TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  course_id   TEXT,
  type        TEXT NOT NULL CHECK (type IN ('evaluation', 'rank_achievement', 'tuition_notice')),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  message_id  TEXT REFERENCES zalo_notifications (id) ON DELETE RESTRICT,
  error       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bulk_job_item_key UNIQUE (job_id, student_id)
);

CREATE INDEX zalo_bulk_job_items_job_idx ON zalo_bulk_job_items (job_id, status);

-- ---------------------------------------------------------------------------
-- zalo_config
-- ---------------------------------------------------------------------------
-- Tu _zalo_config/tokens. Mot hang duy nhat; CHECK khoa lai de khong ai chen
-- hang thu hai roi tu hoi token nao dang duoc dung.
CREATE TABLE zalo_config (
  id            TEXT PRIMARY KEY DEFAULT 'tokens' CHECK (id = 'tokens'),
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT app_attach_touch('notifications');
SELECT app_attach_touch('admin_notifications');
SELECT app_attach_touch('zalo_notifications');
SELECT app_attach_touch('zalo_bot_links');
SELECT app_attach_touch('zalo_bot_messages');
SELECT app_attach_touch('zalo_bulk_jobs');
SELECT app_attach_touch('zalo_bulk_job_items');
SELECT app_attach_touch('zalo_config');

COMMIT;
