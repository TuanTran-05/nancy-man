# Office Academic Findings Fix Design

## Goal

Fix the verified Office Academic and Office Weekly Dashboard findings without broad page rewrites. The work should make batch notification behavior correct, make completion state match what the UI sends, harden date/status parsing, remove dead computation, and reduce duplicate action-state logic.

## Scope

Included:

- Office Academic batch send behavior for evaluation, rank, tuition, and both mode.
- Office Academic completed/pending directory behavior.
- Office Academic enrollment-status and course-date parsing.
- Office Academic duplicated student action-state calculation.
- Office Academic refresh and local sent-state cleanup.
- Office Weekly Dashboard date parsing, schedule guards, search debounce, and multi-select close behavior.
- Focused Vitest coverage for every behavior changed.

Excluded:

- Full decomposition of `src/pages/office/Academic.tsx` into new route-level components.
- New user-facing features beyond correcting existing controls.
- Backend API contract changes.

## Architecture

Keep the existing pages and data flow. Add small pure helpers where the current logic is fragile or duplicated:

- `src/lib/office/dateOnly.ts` owns date-only normalization, timestamp conversion, Vietnam date generation, and date differences.
- `shared/academic.ts` owns normalized academic enrollment-status semantics.
- `src/pages/office/Academic.tsx` keeps its UI but uses helper functions for student action state, rank sending, completion checks, and local sent pruning.
- `src/pages/office/OfficeDashboard.tsx` keeps its component structure but adds `useDebouncedValue` and closes multi-select menus on outside click or Escape.

## Behavior Design

### Academic Batch Sends

`both` mode must send rank when a student already has evaluation sent but rank has not been sent. Evaluation is marked `skipped`, rank is attempted if the final evaluation has a valid ranked value, and tuition can continue because evaluation is already sent.

Rank sending should move into a testable helper that receives all inputs explicitly and returns a status result. The loop then records the result and appends any error message.

### Completed Students

The completed tab should include a student only when:

- evaluation notification is sent;
- tuition notice is sent;
- rank notification is sent if the final evaluation has a ranked value.

Students whose final evaluation has no rank do not require rank to be completed.

Switching to either pending or completed tab resets `studentFilter` to `all`, so tab changes do not silently carry an incompatible filter.

### Academic Status And Dates

Enrollment status comparisons should normalize casing and whitespace before checking for `active` or `on_leave`.

Course end dates should support both `YYYY-MM-DD` and ISO datetime strings. Invalid dates should not become epoch `0`; invalid values should be treated as missing for sorting/status decisions.

### Weekly Dashboard

`daysOfWeek` should be treated as a schedule source only when it is an array. Non-array API values should fall back to an empty schedule instead of crashing.

Date-only math should use the same helper as Office Academic. Invalid dates should return `active` or be treated as missing rather than producing epoch-based classifications.

The search input should debounce filtering so typing does not recompute the full board on every keystroke.

Multi-select menus should close on outside click and Escape.

### Cleanup

Remove `unSentEvaluationsCount` and `unSentTuitionCount` because they are declared but never read.

Prune `localSent` after fresh payload loads by removing local ids already confirmed in summary sent-id arrays. This preserves immediate UI feedback while preventing additive local state from growing indefinitely after server refreshes.

## Testing

Targeted tests should cover:

- `both` mode sends rank when evaluation was already sent and rank was not.
- completed tab excludes ranked students whose rank was not sent.
- uppercase `ON_LEAVE` behaves the same as `on_leave`.
- ISO datetime end dates classify correctly.
- invalid date values do not produce epoch-driven status.
- non-array `daysOfWeek` does not crash dashboard view building.
- multi-select menus close with Escape and outside click.
- search filtering still works with debounce.

Run targeted Vitest files first, then `npm.cmd run typecheck`, then the full relevant test command if time permits.
