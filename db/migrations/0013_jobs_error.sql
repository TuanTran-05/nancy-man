-- Preserve the error payload written by failJobRun(). Without this column the
-- PostgreSQL jobs read cannot reproduce failed Firestore job documents.

BEGIN;

ALTER TABLE jobs ADD COLUMN error JSONB;

COMMIT;
