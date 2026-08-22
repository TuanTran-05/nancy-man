-- 0018_auth_user_providers.sql
-- Native OAuth account links; replaces Firebase Auth provider linkage.

BEGIN;

CREATE TABLE auth_user_providers (
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google')),
  provider_subject TEXT NOT NULL,
  provider_email   TEXT NOT NULL,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider),
  UNIQUE (provider, provider_subject),
  CONSTRAINT auth_provider_email_lowercase CHECK (
    provider_email = lower(btrim(provider_email))
  )
);

CREATE INDEX auth_user_providers_email_idx
  ON auth_user_providers (provider, provider_email);

COMMIT;
