# Payment Incident SOP

Audience: accountant, admin, and the developer on call.

This app does not perform automatic refunds. Refunds, bank reversals, and gateway void/cancel actions are handled outside the app by the accountant or payment provider. The app records internal status, audit history, and reconciliation notes.

## Roles

- Accountant: verifies bank/gateway records, resolves `needs_review`, voids receipts, records manual notes.
- Admin: can assist with user/account access and audit export.
- Developer: investigates webhook, reconciliation, and data consistency issues.

## Daily Checks

1. Open Finance -> Online payments.
2. Filter `needs_review`; resolve every item before end of day.
3. Filter `pending`; treat payments older than 15 minutes as warning cases.
4. Check payment health for expired webhook processing leases, failed webhooks, and create failures.
5. Use the row-level PayOS refresh action for each suspicious payment; scheduled reconciliation runs daily and can be re-run safely with the cron secret during an incident.
6. Export or screenshot gateway evidence before approving a reviewed payment.

## Operator Review Flow

1. Open the PayOS review queue.
2. Compare PayOS transaction reference, amount, order code, ledger, student, class, and receipt id.
3. Approve only when bank or PayOS confirms one correct payment for the same ledger.
4. Reject only with a written reason and evidence.
5. For duplicate real money, do not delete records; create a refund or credit-note workflow outside the app and record the reference.

## Payment review case handling

Every open `payment_review_cases` document must be reviewed by accounting before end of day.

Required closeout evidence:

- PayOS order code
- Gateway amount
- EduTrack payment request id
- Ledger id
- Receipt id, if posted
- Accounting decision: posted, rejected, refunded, or external manual handling
- Reviewer uid
- Reviewed timestamp

Alert thresholds:

- `pending` payment older than 15 minutes: warning.
- Expired `processing` webhook lease: critical.
- `needs_review > 0`: accounting review required before end of day.
- API 5xx rate above 1% for 5 minutes: critical.
- Firestore quota above 80%: warning.
- Any `critical` review case open for more than 15 minutes.
- Any `warning` review case open for more than 1 business day.
- More than 3 orphan cases in 1 hour.

## Manual PayOS Reconciliation

1. Confirm the operator has admin or accounting access and a valid incident reason.
2. Open Finance -> Online payments and run the payment health check.
3. For one suspicious payment, use the row-level PayOS refresh action first.
4. If multiple rows are stale, run the protected reconcile endpoint with `Authorization: Bearer <CRON_SECRET>`; `x-vercel-cron` alone is not sufficient.
5. Review the reconcile summary: `processed`, `posted`, `needsReview`, `leased`, and `deadlineReached`.
6. Resolve any `needs_review` case through the existing resolve-review flow. Approve only when PayOS is `PAID`, amount matches, and student/ledger match.
7. Attach gateway evidence, reconcile output, and the final review decision to the incident record.

## Incident Types

### Gateway Paid, App Still Pending

1. Run PayOS reconciliation from Finance.
2. If status becomes `paid`, confirm a receipt was created and ledger balance changed.
3. If status becomes `needs_review`, compare `orderCode`, amount, payment link id, and gateway reference.
4. Approve only when gateway status is `PAID` and amount exactly matches the internal payment request.
5. Add the gateway reference to the review reason/note.

### App Shows Paid, Gateway Does Not Show Paid

1. Do not void immediately.
2. Search PayOS by `orderCode` and payment link id.
3. Check receipt status and audit log.
4. If payment was incorrectly posted, void the receipt in the app and record the reason.
5. Escalate to developer with payment request id, receipt id, order code, and audit log export.

### Duplicate Payment

1. Identify all payment requests for the same ledger/student.
2. Confirm which transaction is valid in PayOS/bank records.
3. Keep the valid paid receipt.
4. Mark duplicate/internal incorrect records via manual void flow where applicable.
5. Process any real-world refund or cancellation outside the app.
6. Record the external action reference in the note.

### Amount Mismatch or Overpayment

1. Do not approve automatically.
2. Compare app amount snapshot with gateway amount.
3. If the amount is incorrect or exceeds remaining tuition, reject or leave for manual handling.
4. Accountant decides external correction/refund outside the app.
5. Record the decision, amount, and external reference.

### Fake or Invalid Callback Suspected

1. Check whether the payment has a valid PayOS signature event in `webhook_events`.
2. Ignore unsigned screenshots or browser callback evidence.
3. Use PayOS dashboard/bank statement as source of truth.
4. Escalate to developer if invalid webhook attempts spike.

## Required Evidence

- PayOS order code.
- Payment request id.
- Ledger id.
- Receipt id if any.
- Gateway status screenshot or exported row.
- Bank reference/transaction id.
- Accountant note describing the manual decision.
- The payment row status before and after any single-payment refresh.

## Retention

Finance/payment/webhook evidence is retained for 7 years. Do not delete payment-related audit logs, `webhook_events`, `payment_review_cases`, receipts, invoices, or ledgers during an incident.

## Resolution Rules

- Approve `needs_review` only when gateway status is `PAID`, amount matches, and the student/ledger match.
- Reject when the payment is duplicate, cancelled, expired, amount-mismatched, or belongs to another ledger.
- Use receipt void for internal correction. Do not use app void as proof that money was refunded.
- Never edit amount from the browser or database manually for a payment request.

## Escalation to Developer

Escalate when:

- Reconciliation throws errors.
- Webhook events are stuck in `processing`.
- A paid gateway transaction cannot be matched to a payment request.
- Ledger paid total and receipt total differ.

Include: affected ids, timestamps, screenshots, and the exact action the accountant already took.
