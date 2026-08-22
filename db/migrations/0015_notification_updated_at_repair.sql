-- Migration 0014 made notifications.updated_at nullable, but its data repair
-- was intercepted by the table's BEFORE UPDATE touch trigger. Disable only
-- that trigger inside this transaction, repair the three source documents
-- that omit updatedAt, then restore normal write behavior.

BEGIN;

ALTER TABLE notifications DISABLE TRIGGER trg_touch_updated_at;

UPDATE notifications
SET updated_at = NULL
WHERE id IN (
  '0RrIXLVqzj5KuXTsjupW',
  '5mnZ1UQdJX7qH45bGdzW',
  '8eeUgmNN9Knk0r5NkKYX'
);

ALTER TABLE notifications ENABLE TRIGGER trg_touch_updated_at;

COMMIT;
