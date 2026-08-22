# Students Directory Query Cache Design

## Context

The Students page currently remounts whenever navigation changes `location.pathname`. Its
non-accounting directory hook then repeats three bulk reads: the full student roster, the admin
ledger summary, and assignment submissions used for GPA. Phase 1 already moved the monthly
reports read behind a roster-first collapsible panel and added a guarded manual refresh button.

The approved target is Facebook-style return navigation: cached rows render immediately, no bulk
read repeats within 15 minutes unless the user explicitly refreshes or a matching realtime event
arrives, and an active page refreshes itself every 15 minutes without blanking the table.

## Considered Approaches

1. **Three TanStack Query entries (selected).** Roster, ledgers, and graded submissions get
   independent keys and invalidation. This uses the existing app-level `QueryClientProvider`,
   avoids new dependencies, and prevents a finance or GPA event from re-reading the full roster.
2. **One combined directory query.** This is a smaller hook edit, but every invalidation repeats all
   three bulk reads and preserves the current over-fetching problem.
3. **A custom module-level cache.** This could mimic a TTL, but would duplicate query lifecycle,
   retry, garbage-collection, observer, and refetch behavior already supplied by TanStack Query.

## Architecture

Create a focused `studentDirectoryQueries.ts` module that owns cache timings, user-scoped query
keys, and the three read functions. `useStudentDirectoryData` consumes those query options for all
non-accounting roles. The existing local state remains authoritative for the accounting role so
its first-page replacement, cursor paging, and class-filter behavior do not change.

Every key contains the authenticated Firebase uid and the current role:

- `['student-directory', uid, role, 'roster']`
- `['student-directory', uid, role, 'ledgers']`
- `['student-directory', uid, role, 'graded-submissions']`

This prevents a cache entry from one signed-in account or role being displayed by another account
in the same SPA session.

## Cache and Refresh Policy

- `staleTime`: 15 minutes for all three bulk datasets.
- `refetchInterval`: 15 minutes while the Students hook remains mounted.
- `refetchIntervalInBackground`: false, so a hidden browser tab does not poll.
- `gcTime`: 30 minutes after the last observer unmounts.
- Query retries: disabled for these bulk reads to preserve the current one-attempt behavior and
  avoid silently buying repeated collection reads.
- A fresh remount within 15 minutes renders the cached value and performs no bulk API request.
- A stale remount or an active observer reaching 15 minutes performs a background refetch while
  preserving the last successful rows.
- The existing manual refresh calls all enabled query `refetch` functions and retains its Phase 1
  double-click guard.

## Role Behavior

- Admin: roster, ledgers, and graded submissions queries are enabled.
- Teacher: roster and graded submissions queries are enabled; ledgers remain empty.
- Office: only the roster query is enabled; ledgers and submissions remain empty.
- Accounting: all three client queries are disabled. Existing `accounting-students` first-page and
  cursor pagination behavior remains unchanged.
- Missing authentication or role: all queries are disabled and loading resolves to false.

The existing Firestore `onSnapshot` listeners for classes and parent profiles, the one-shot teacher
`getDocs`, and accounting cursor state remain in `useStudentDirectoryData`.

## Realtime Invalidation

Keep `useInvalidationRefresh` as the debounced event transport, but register independent consumers:

- `students` refetches only the roster query for non-accounting roles.
- `finance-ledger` refetches only the admin ledger query.
- `submissions` refetches only the admin/teacher graded-submissions query.
- Accounting continues listening to `accounting-students` and refreshes its existing server page.

The first Firestore snapshot is still skipped by `useInvalidationRefresh`, so mounting a fresh
query does not immediately refetch it a second time.

Assignment submission mutations also touch the Firestore `submissions` realtime event after a
successful write that changes the active graded set. This bridges the server's existing RTDB delta
notifications to the event transport used by `useInvalidationRefresh`: standard and Assessment v2
grading always participate, auto-graded submissions participate at creation, and deletion only
participates when at least one active graded submission is removed. Ordinary ungraded submissions
do not buy a directory-wide assignments reread. The assignments reader excludes soft-deleted
submissions before projection so deletion refetches actually remove those grades from GPA input.

## Loading and Error Semantics

`loading` means an enabled query has no successful cached value yet. Background refreshes expose
the cached data and do not return the page to its initial-loading state. The public `error` remains
a single string: accounting local errors take precedence in accounting mode; otherwise the first
roster, ledger, or submission query error is surfaced. Successful sibling queries may still render
their cached data when one query fails.

## Testing

Tests use a real `QueryClient` with retry disabled and a shared client across unmount/remount.
Coverage must prove:

1. A second admin mount within 15 minutes does not repeat any of the three bulk reads.
2. Cache keys include uid and role.
3. `students`, `finance-ledger`, and `submissions` invalidations refetch only their matching query.
4. Manual refresh still refetches every enabled admin query.
5. Switching authenticated uid without changing role rebinds identity-scoped reads and listeners.
6. Submission mutations emit the Firestore invalidation event consumed by the Students page.
7. Accounting first-page replacement and cursor paging remain unchanged.
8. Existing Students roster-first tests, typecheck, and the full Vitest suite remain green.

## Out of Scope

- Caching the monthly reports panel or student profile report.
- Replacing Firestore class/parent listeners.
- Changing accounting pagination.
- Persisting QueryClient data across hard browser reloads.
