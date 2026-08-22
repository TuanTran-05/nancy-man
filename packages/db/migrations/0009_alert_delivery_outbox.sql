ALTER TABLE alert_deliveries
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0);

ALTER TABLE alert_deliveries
  DROP CONSTRAINT IF EXISTS alert_deliveries_delivery_kind_check;

ALTER TABLE alert_deliveries
  ADD CONSTRAINT alert_deliveries_delivery_kind_check
  CHECK (delivery_kind IN ('new', 'digest', 'reminder', 'escalation', 'resolved', 'regressed'));

CREATE INDEX IF NOT EXISTS alert_deliveries_due_idx
  ON alert_deliveries (requested_at, claimed_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
