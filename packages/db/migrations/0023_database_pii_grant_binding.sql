-- Older 0022 deployments may already have grants with the policy's reusable
-- behavior represented only in application code. Persist it before enforcing
-- the database PII binding contract.
UPDATE ops_secret_elevations
SET reusable = TRUE
WHERE capability = 'database_pii' AND reusable IS FALSE;

ALTER TABLE ops_secret_elevations
  ADD CONSTRAINT ops_secret_elevations_database_pii_binding_check
  CHECK (
    capability <> 'database_pii'
    OR (reusable IS TRUE AND subject_digest IS NOT NULL)
  );

CREATE INDEX ops_secret_elevations_database_pii_grants_binding_active_idx
  ON ops_secret_elevations (
    user_id,
    session_id,
    ip_hash,
    user_agent_hash,
    subject_digest,
    expires_at
  )
  WHERE capability = 'database_pii'
    AND reusable IS TRUE
    AND consumed_at IS NULL
    AND revoked_at IS NULL;
