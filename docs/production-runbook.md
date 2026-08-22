# Production Runbook

## Database load spike

1. Check PostgreSQL connections, slow queries, CPU, memory, disk latency, and lock waits.
2. Check whether admin dashboard, calendar, reports, class detail, or parent dashboard traffic is bypassing the bounded read API channels.
3. Confirm `api/read` requests use `limit <= 200`, `calendar-window` is at most 45 days, and report reads use bounded date ranges.
4. Disable optional polling for the affected screen and restart the VPS application if a rollout is required.
5. Confirm query latency and connection-pool pressure drop within 15 minutes.
6. Export affected application and PostgreSQL logs and attach them to the incident record.

## PayOS webhook outage

1. Confirm the scheduled PayOS reconcile cron is running every 10 minutes and is protected by `CRON_SECRET`.
2. Check Finance -> Online payments for `needs_review`, `pending 15m+`, stale creating sessions, and expired webhook processing leases.
3. For each affected payment, use the single-payment PayOS refresh action in the row.
4. Check open `payment_review_cases`.
5. Compare PayOS successful transactions against `payment_requests` for the same time window.
6. If more than one payment is stale, run the protected reconcile endpoint with `Authorization: Bearer <CRON_SECRET>`.
7. Review the summary fields `processed`, `posted`, `needsReview`, `leased`, and `deadlineReached`.
8. Manually resolve cases through the resolve-review flow.
9. Keep payment creation enabled only if webhook handling, reconciliation, and single-payment refresh are passing.

## Monitoring alerts

- `pending payment > 15 minutes`: warning.
- `processing webhook lease expired`: critical.
- `needs_review > 0`: accounting review required.
- `api 5xx > 1% over 5 minutes`: critical.
- `PostgreSQL pool saturation or disk usage > 80%`: warning.

## API authorization regression

1. Revert to the last known-good application artifact.
2. Run the focused authorization tests plus `npm.cmd run test:vps`.
3. Deploy the corrected application through the VPS activation flow.
4. Verify parent/student users cannot access raw student or payment records through any API route.
5. Record the incident in audit logs.

## Payment diagnostics scrub

1. Take a fresh PostgreSQL backup with `deploy/vps/backup-postgres.sh`.
2. Run `npm.cmd run audit:payment-diagnostics`.
3. If flagged rows exist, review the JSON report with accounting/developer on call.
4. Run `node scripts/audit-payment-diagnostics.mjs --apply` only after backup confirmation.
5. Re-run the dry-run and attach the before/after report to the launch evidence.

## Backup and restore drill

1. Create a staging PostgreSQL backup with `deploy/vps/backup-postgres.sh`.
2. Restore it into an isolated PostgreSQL database that is not reachable by production traffic.
3. Run `db/verify-schema.sql` and `db/verify-data.sql` against the restored database.
4. Validate expected row counts for users, students, course fee ledgers, receipts, payment requests, and audit logs.
5. Run the payment diagnostics dry-run against the restored database and attach the report.
6. Record the backup path, restore command output, validation counts, and reviewer in the launch checklist.

## Payment incident drill

In staging, simulate and record evidence for:

1. PayOS paid webhook received once.
2. Duplicate paid webhook.
3. Timeout after webhook claim, then retry or reconcile.
4. Amount mismatch.
5. Unknown order code.

Acceptance: valid payment creates exactly one receipt, stale claimed webhook posts or opens review, and every review case is visible to accounting/admin.

## Evidence retention

1. Keep finance, payment, webhook, and audit evidence for 7 years.
2. Do not manually delete `webhook_events`, `payment_review_cases`, `receipts`, `course_fee_ledgers`, `invoices`, or payment-related audit logs.
3. Export evidence before any external refund, reversal, or manual accounting correction.

## Zalo Bot Operations

For procedures regarding Zalo Bot setup, deployment, pilot rollout, and rollback, see the [Zalo Bot Operations Runbook](./zalo-bot-runbook.md). Delivery is at-least-once because of network retries; always check `deliveryAmbiguous` before manually retrying failed messages. Verify the 21:30/21:35 jobs in the VPS cron and PM2 logs.
