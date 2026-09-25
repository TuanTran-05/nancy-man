ALTER TABLE ops_secret_elevations
  DROP CONSTRAINT IF EXISTS ops_secret_elevations_capability_check;

ALTER TABLE ops_secret_elevations
  ADD CONSTRAINT ops_secret_elevations_capability_check
  CHECK (capability IN ('accounts_write', 'variables_secret', 'variables_apply', 'database_pii'));
