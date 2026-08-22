# G3 Huynh Le Frozen Zalo Resend Design

## Goal

At 08:00 Asia/Ho_Chi_Minh on 2026-08-05, resend the course-closing evaluation, ranked-achievement notice when applicable, and next-course tuition notice for the 13 eligible students in class `MbEjkY4bZPvUt9ykRpPu` (`G3 - Huynh Le T4-T6`). The send must remain correct after the operator resets the course in EduTrack.

## Confirmed Scope

- Freeze exactly 13 eligible students. Exclude the two on-leave students without final evaluations.
- Freeze one evaluation payload and one tuition payload per recipient.
- Freeze a rank payload only for the two recipients whose final evaluation has a ranked result.
- Freeze tuition at `1,200,000 VND` and all rendered course dates used by the Zalo templates.
- Freeze the normalized destination phone number so later course or student edits cannot change the scheduled recipients.
- Run once at 08:00 on 2026-08-05. Update the existing paused automation; do not create a second schedule.

## Recommended Architecture

Use two committed, reusable scripts and one generated private snapshot:

1. A snapshot generator reads the current class, eligible students, selected final evaluations, ranks, tuition, and derived tuition schedule. It renders the exact Zalo template payloads and writes one immutable JSON snapshot.
2. A snapshot sender reads only that JSON file for recipient and message data. At send time it may access Firestore only for Zalo token state and append-only notification audit logs. It must not read classes, students, evaluations, ledgers, or course dates.
3. The generated snapshot lives under a gitignored private runtime directory because it contains phone numbers and student education data. The repository must never commit that payload.

This is preferred over hard-coding personal data in a committed TypeScript file and over copying the source records to another Firestore collection.

## Snapshot Contract

The JSON document contains:

- schema version and creation timestamp;
- class ID and display name;
- frozen course start/end dates and frozen next-course tuition schedule;
- tuition amount;
- expected counts: 13 evaluations, 2 ranks, and 13 tuition notices;
- for every recipient: immutable student document ID, student code, display name, normalized phone, evaluation template data, optional rank template data, and tuition template data;
- a SHA-256 checksum over the canonical payload.

The checksum is verified before any outbound request. The sender also validates the exact class ID, amount, counts, unique student IDs, unique student codes, valid normalized phones, and required template fields. Any validation mismatch aborts the whole run before the first message.

## Sending and Audit Flow

The sender refreshes the Zalo access token before sending. For each recipient it sends messages in this order:

1. evaluation;
2. rank, only when the frozen snapshot contains a ranked result;
3. tuition.

Each attempt creates a new `zalo_notifications` record containing the frozen class/student identifiers, frozen destination phone, template ID, message type, status, Zalo message ID or error, snapshot checksum, source `scheduled_snapshot_resend`, and resend identifier `scheduled-resend-g3-huynh-le-2026-08-05`. Existing logs are never edited or deleted.

The sender does not update a course fee ledger because the course may have been reset or archived. The immutable notification log is the audit source for this one-time resend.

## Failure Handling

- Snapshot validation, count mismatch, amount mismatch, missing template configuration, or token refresh failure: abort before sending anything.
- Zalo failure for an individual message: log the failure and continue with later recipients so one invalid destination does not block the other families.
- Do not send tuition for a recipient when that recipient's evaluation resend fails in the same run. Record tuition as skipped in the final report.
- Do not retry the entire automation automatically. The schedule has one occurrence only, preventing duplicate bulk sends.

## Automation

Keep the current automation paused until implementation, snapshot generation, and dry-run verification succeed. Then update that same automation to run the snapshot sender once at 08:00 Asia/Ho_Chi_Minh on 2026-08-05. Its prompt must name the exact snapshot path and checksum, require a dry run first, and require the dry run to report 13 evaluations, 2 ranks, 13 tuition notices, and `1,200,000 VND` before apply.

## Testing and Verification

- Unit-test canonical checksum creation and tamper detection.
- Unit-test snapshot validation for exact counts, amount, duplicate students, invalid phones, and missing required fields.
- Unit-test send selection: 13 evaluations, 2 conditional ranks, and 13 tuition notices.
- Unit-test that a failed evaluation skips tuition for only that recipient.
- Run focused tests and TypeScript typecheck.
- Generate the production snapshot before course reset and inspect a redacted summary only.
- Run the snapshot sender in dry-run mode and verify the exact class ID, amount, counts, checksum, and masked destinations.
- Update and reactivate the existing one-time automation only after all checks pass.
