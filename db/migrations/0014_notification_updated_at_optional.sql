-- Firestore notifications may omit updatedAt. Preserve that absence so the
-- PostgreSQL read projection does not invent a timestamp during cutover.

BEGIN;

ALTER TABLE notifications ALTER COLUMN updated_at DROP NOT NULL;

-- These three source documents had no updatedAt in the final snapshot. The
-- loader used its snapshot timestamp as a fallback; constrain the repair by
-- both id and value so a later legitimate update can never be erased.
UPDATE notifications
SET updated_at = NULL
WHERE id IN (
  '0RrIXLVqzj5KuXTsjupW',
  '5mnZ1UQdJX7qH45bGdzW',
  '8eeUgmNN9Knk0r5NkKYX'
)
AND updated_at = TIMESTAMPTZ '2026-08-19T07:10:13.078Z';

COMMIT;
