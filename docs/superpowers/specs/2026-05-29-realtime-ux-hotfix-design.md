# Realtime UX Hotfix Design

## Goal

Fix the remaining production-critical gaps from the realtime UX implementation without widening the scope into a full hardening pass.

This hotfix focuses on user-visible finance/payment latency and event security:

- `realtime_events` must use safe role scopes per channel.
- PayOS successful payment posting must invalidate all affected read models.
- Course fee ledger generation must refresh Finance immediately and invalidate related dashboards.
- ParentTuition background refresh must not replace existing content with a full-page spinner.

## Out Of Scope

- Full cleanup of all invalidation hook lifecycle edge cases.
- Backend event coverage for every secondary page.
- Broad client subscription registry refactor.
- Redesigning UI screens.
- Reworking finance or PayOS business logic.

Those items belong to the follow-up hardening spec.

## Current Gaps

### Event Scope

`api/lib/realtime/events.ts` currently falls back to a broad default `roleScope`. That can make finance activity event docs visible to roles that should not receive them, and it can also omit valid roles such as `accounting`.

### PayOS Invalidation

PayOS shared posting logic creates receipts, updates ledgers, and marks payment requests as paid, but it does not touch `finance-receipt`, `finance-ledger`, `parent-tuition`, or `accounting-students`. This means webhook/status/reconcile/resolve flows can update canonical server data while mounted pages stay stale.

### Ledger Generation Refresh

Finance calls `generateCourseFeeLedgersInBatches`, but the page does not refresh `ledgers` after success. The backend generate-ledgers endpoint also does not touch finance/parent/accounting invalidation events.

### ParentTuition Background Loading

`useParentTuitionData.refresh()` uses the same `loading` state for both initial load and background refresh. ParentTuition renders a full-page spinner whenever `loading` is true, so invalidation refresh can hide existing data instead of keeping the page stable.

## Design

### 1. Channel Role Scope Map

Add a default role-scope map inside `api/lib/realtime/events.ts`.

```ts
const DEFAULT_REALTIME_EVENT_ROLE_SCOPE: Record<RealtimeEventKey, string[]> = {
  students: ['admin', 'teacher', 'office', 'accounting', 'level_manager'],
  'finance-ledger': ['admin', 'accounting'],
  'finance-receipt': ['admin', 'accounting'],
  'finance-expense': ['admin', 'accounting'],
  'parent-tuition': ['admin', 'parent', 'student'],
  'parent-dashboard': ['admin', 'parent', 'student'],
  'admin-summary': ['admin'],
  admissions: ['admin', 'office'],
  'level-management': ['admin', 'level_manager'],
  'accounting-students': ['admin', 'accounting'],
  'knowledge-bank': ['admin', 'teacher', 'office', 'accounting', 'level_manager'],
};
```

`touchRealtimeEvent(key, options)` should:

- use `options.roleScope` only when explicitly passed,
- otherwise use the key-specific default,
- write only `key`, `targetId?`, `version`, `updatedAt`, `roleScope`,
- never accept or persist PII fields.

Firestore rules can continue authorizing by `resource.data.roleScope`.

### 2. PayOS Paid Event Touch

Add event touching after a PayOS payment is canonically posted. The best place is the shared PayOS function that performs the receipt/ledger/payment write, because it is reused by:

- webhook,
- status refresh,
- reconcile,
- review resolution.

After the main transaction succeeds and a receipt is created or confirmed, touch:

- `finance-receipt`,
- `finance-ledger`,
- `parent-tuition`,
- `accounting-students`.

The event touch should remain non-blocking for business correctness. If touch fails, log it and keep the payment response successful.

Do not touch events when the PayOS flow ends in `needs_review`, `failed`, `cancelled`, or `expired` without posting receipt/ledger changes. Payment list refresh can stay driven by the explicit API response and manual `loadPayments('reset')` in Finance.

### 3. Course Ledger Generation Refresh

Frontend Finance:

- after `generateCourseFeeLedgersInBatches` succeeds, call `refreshFinanceResource('ledgers')`,
- if created count is positive, also refresh dependent projections that the current page holds if cheap and already loaded, especially `students` if ledger summary is displayed through student projection,
- no optimistic insertion of generated ledgers.

Backend classes generate-ledgers:

- after a batch creates one or more ledgers, touch:
  - `finance-ledger`,
  - `parent-tuition`,
  - `accounting-students`.
- touch each affected channel once per successful request, not once per ledger.
- if no ledgers are created, no event touch is required.

### 4. ParentTuition Background Refresh State

Update `useParentTuitionData` to expose:

```ts
{
  feeLedgers,
  feeReceipts,
  loading,
  refreshing,
  error,
  isStale,
  refresh,
}
```

Semantics:

- `loading`: initial load only, when no usable data is available yet.
- `refreshing`: background refresh while existing data remains visible.
- `error`: latest load/refresh error.
- `isStale`: true after refresh failure while old data remains visible.
- `refresh()`: keeps current ledgers/receipts on failure.

ParentTuition should:

- keep the full-page spinner only for initial load with no existing data,
- show a subtle sync indicator or reuse existing PayOS message during refresh,
- not clear the table/card data on background refresh failure.

## Tests

### Unit Tests

- `touchRealtimeEvent` uses key-specific default role scopes.
- Finance event defaults include `accounting` and exclude `parent`/`student`.
- Parent dashboard/tuition event defaults include `parent` and `student`.
- `touchRealtimeEvent` writes no fields outside the minimal payload.
- `useParentTuitionData.refresh` sets `refreshing` instead of initial `loading` when data already exists.
- `useParentTuitionData.refresh` failure keeps previous ledgers/receipts and sets `isStale`.

### Integration / Component Tests

- PayOS paid shared flow touches `finance-receipt`, `finance-ledger`, `parent-tuition`, and `accounting-students`.
- Finance generate ledgers success calls `refreshFinanceResource('ledgers')` or observes the corresponding refreshed list in the component.
- ParentTuition does not switch to full-page spinner during an invalidation refresh with existing data.

### Regression

Run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:rules
```

## Acceptance

- Parent/student cannot read finance realtime event docs through default event scope.
- Accounting can read finance realtime event docs.
- PayOS paid from webhook/status/reconcile/resolve causes Finance, ParentTuition, and AccountingStudents to refresh through event invalidation.
- Generating course fee ledgers updates Finance ledgers without page reload.
- ParentTuition keeps visible tuition data during background refresh and refresh failure.
- No direct raw client read of `/students` is introduced.
- Existing full regression commands pass.

## Follow-Up Hardening Spec

The next spec should cover:

- invalidation hook mounted guard and late async cleanup,
- role-aware client subscription helper usage at every page,
- backend event coverage for admissions/admin-summary/parent-dashboard/level-management/knowledge-bank where needed,
- rules tests for realtime event roles and denied writes,
- additional stale indicators on other readChannel screens.
