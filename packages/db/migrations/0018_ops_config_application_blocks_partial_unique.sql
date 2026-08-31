ALTER TABLE ops_config_application_blocks
  DROP CONSTRAINT IF EXISTS ops_config_application_blocks_pkey;

DROP INDEX IF EXISTS ops_config_application_blocks_active_idx;

CREATE UNIQUE INDEX ops_config_application_blocks_active_idx
  ON ops_config_application_blocks (application_id)
  WHERE cleared_at IS NULL;
