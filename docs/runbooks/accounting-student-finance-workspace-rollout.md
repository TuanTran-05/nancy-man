# Accounting student finance workspace rollout

## Preconditions

1. Apply the reviewed PostgreSQL migrations and confirm the VPS health check is green.
2. Run a dry-run backfill and projection audit:

```bash
npm run audit:student-course-enrollments -- --write-manifest .tmp/student-course-enrollments-manifest.json
npm run audit:accounting-student-summaries
```

3. Repair only after reviewing the dry-run output:

Set `approved: true` in the reviewed manifest before applying it; apply mode also verifies the checksum.

```bash
npm run audit:student-course-enrollments -- --manifest .tmp/student-course-enrollments-manifest.json --apply
npm run repair:accounting-student-summaries
```

## Progressive rollout

The student/course workspace is enabled by default and is the default Finance tab. Keep
`VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE=true` in explicit environment templates for clarity.
Set `VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE=false` only when rolling back to the legacy ledger tab.
Monitor the `accounting-student-finance` realtime channel and the `dataIncomplete` response flag.

## Stop conditions

Pause rollout and disable the flag if any of the following occurs:

- summary health reports a source-version mismatch, incomplete rebuild, or student/summary count mismatch;
- payment status or outstanding totals differ from the source ledger audit;
- a role can read `student_course_enrollments`, projection summaries, or outbox documents directly;
- projection rebuild failures accumulate without the outbox retry queue draining.

After remediation, rerun both audits and a sampled profile/ledger reconciliation before re-enabling.
