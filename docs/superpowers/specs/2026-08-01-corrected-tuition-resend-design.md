# Corrected Tuition Resend Design

## Goal

Resend only the corrected next-course tuition notice for class `aoaDsr3lgBvSj211VCkJ` (`G3-Mr. Đạt-CNT2`) after its tuition fee was corrected from the previously sent value to `1,200,000 VND`.

## Confirmed Scope

- Target exactly the class ID above; do not rely on a fuzzy class-name match during the send.
- Target the 10 current students who have final evaluations and previously received the course-closing tuition notice.
- Send only the next-course tuition template. Do not resend evaluations or rank notices.
- Read the amount from the class document and abort unless it equals `1,200,000 VND`.
- Preserve all earlier Zalo notification logs, including the incorrect sends.

## Approach

Extend the existing manual resend tool with an explicit force-tuition-resend option. The option is valid only together with tuition-only mode. Normal resend behavior remains unchanged: previously sent tuition notices are skipped unless both flags are present.

The operator first runs a dry run using the exact class ID. The dry run must show 10 targeted students, tuition `1,200,000 VND`, no evaluation sends, and 10 tuition sends. The apply run then uses the same exact arguments plus the existing `--apply --yes` safety gates.

## Audit and Error Handling

Each attempt writes a new `zalo_notifications` record with the corrected amount, send status, Zalo message ID or error, source `manual_resend`, and a distinct correction-specific `resendBy` value. Previous records are never deleted or edited.

The tool aborts before sending if the class is missing, the amount is not `1,200,000 VND`, the target count differs from 10, or a fresh Zalo access token cannot be obtained. Individual send failures are logged and reported without being presented as successful.

## Verification

- Add a focused automated test for the resend decision: a previously sent tuition notice is skipped normally and selected only when force-tuition-resend is combined with tuition-only mode.
- Run the focused test and TypeScript typecheck.
- Run the production dry run and verify the exact class, amount, target count, and tuition-only actions.
- After apply, verify the command result reports 10 successful tuition sends and no evaluation or rank sends.
