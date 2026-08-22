# PostgreSQL disaster recovery runbook

## Non-negotiable safety rules

- Do not run a drill against the production data directory, production host, or
  production database URL.
- Confirm the private ownership record names three distinct backup, standby and
  isolated-restore hosts before starting.
- A successful restore never authorizes an automatic production cutover.
- Keep `OPS_SQL_MUTATION_ENABLED=false` until the rollout gate is separately
  approved.

## Monthly drill workflow

1. Start a disposable production-shaped database and record the drill marker
   commit time and target timestamp/LSN.
2. Run exactly one scenario from `requiredScenarios` with a designated
   operator and current tool release SHA.
3. Restore only to the configured isolated host using `restore-isolated.sh`.
4. Run `verify-restored-database.sh` against an `edutrack_recovery_*`
   database, then collect RPO/RTO from the declared and ready timestamps.
5. Sign the evidence with the off-database Ed25519 key and upload it to the
   private audit bucket. Do not commit evidence or rows to Git.
6. Evaluate all seven current signed scenarios. Any missing, failed, expired,
   unsigned, RPO-over-60-second or RTO-over-900-second scenario keeps the gate
   disabled.

## Required scenarios

- `single_row_update`
- `mass_delete`
- `truncate_table`
- `drop_table`
- `primary_host_loss`
- `backup_host_unavailable`
- `wrong_target_rejected`
