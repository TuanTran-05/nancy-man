-- 0016_vps_auth_sessions.sql
-- Native VPS authentication. Firebase Auth is no longer a runtime dependency.

BEGIN;

CREATE TABLE staff_password_credentials (
  user_id          TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  password_hash    TEXT NOT NULL,
  password_salt    TEXT NOT NULL,
  password_version SMALLINT NOT NULL DEFAULT 2 CHECK (password_version = 2),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_password_secret_complete CHECK (
    btrim(password_hash) <> '' AND btrim(password_salt) <> ''
  )
);

CREATE TABLE auth_sessions (
  token_hash       TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('password', 'google', 'student', 'parent')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  ip_hash          TEXT,
  user_agent       TEXT,
  CONSTRAINT auth_session_expiry CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, expires_at DESC);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE auth_rate_limits (
  key_hash         TEXT PRIMARY KEY,
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_until    TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_rate_limits_blocked_idx ON auth_rate_limits (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE TABLE auth_otp_challenges (
  id               TEXT PRIMARY KEY,
  student_id       TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  login_type       TEXT NOT NULL CHECK (login_type IN ('student', 'parent')),
  phone            TEXT NOT NULL,
  otp_hash         TEXT NOT NULL,
  attempts         SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  expires_at       TIMESTAMPTZ NOT NULL,
  verified_at      TIMESTAMPTZ,
  consumed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_otp_challenges_expiry_idx ON auth_otp_challenges (expires_at)
  WHERE consumed_at IS NULL;

SELECT app_attach_touch('staff_password_credentials');
SELECT app_attach_touch('auth_rate_limits');

COMMIT;
