# Office Role Page Query Caching Design

**Date:** 2026-08-15

**Status:** Approved design, revised 2026-08-15 after code verification, pending
implementation plan

**Scope:** Every route accessible to the `office` role

## Revision Note (2026-08-15)

The first draft was checked against the code before planning. Seven statements
did not survive that check, and this revision corrects them:

1. `/academic` cannot be split into overview and detail queries without changing
   the `office-academic` read channel's projection, which the Non-goals forbid.
   The split is deferred; this project caches the existing single payload.
2. `office-academic` is already the name of a read channel. The new realtime
   events are named `office-schedule-changed` and `office-academic-changed` to
   keep the two registries distinguishable.
3. The Office dashboard read takes no week or range parameter, so its query key
   carries no parameters.
4. `gcTime` is **30 minutes**, not two hours, because that is what all three
   existing cached modules use and one of them is declared the reference.
5. Query keys are domain-first. There is no literal `office` namespace, because
   most Office routes are shared with other roles.
6. Course-closing normalization has documented exceptions; its signed-URL query
   must keep `gcTime: 0`.
7. The bridge increases the count of cheap single-document listeners. The
   success criterion is restated to measure broad collection listeners.

## Context

Office users regularly switch among schedule, academic, admissions, teacher,
class, student, and support pages. Most of these pages currently keep fetched
data in component-local state. Route changes unmount those components, so
returning to an unchanged page repeats large Firestore or API reads and shows a
full loading state again.

This is particularly wasteful for pages whose data changes infrequently. The
weekly center schedule and academic summaries are examples: they are useful
immediately on revisit, but they do not need to be rebuilt every time a tab is
selected.

Some routes already use realtime listeners, while the student directory and
course-closing areas already use TanStack Query to different degrees. The
design therefore standardizes caching and invalidation without changing server
permissions, projection rules, or business calculations.

## Goals

- Reopening an Office page with a fresh cache must render immediately without
  another bulk read.
- Fresh data must arrive promptly after a relevant mutation, including a
  mutation performed by another signed-in account.
- Cached content must remain visible during background refreshes and transient
  failures.
- Query data must be isolated by authenticated identity, role, and relevant
  page parameters.
- Broad page-owned collection listeners and repeated aggregate reads must
  decrease, not increase.
- The design must cover all Office-accessible routes, including direct routes
  that are not present in the sidebar.

## Non-goals

- Persisting Office query data in `localStorage`, IndexedDB, or across browser
  restarts.
- Changing Firestore security rules, API authorization, or server-side data
  projection semantics.
- Keeping every route component mounted.
- Prefetching every Office page after sign-in.
- Rewriting business calculations solely for this caching project.
- Replacing small realtime subscriptions when they are already the correct
  source of truth and do not cause expensive remount work.
- Moving durable navigation state such as the selected month or class into the
  URL. That is a separate concern, tracked as optional follow-up work.

## Considered Approaches

### 1. Domain query caches plus an app-shell invalidation bridge

Use TanStack Query for durable in-session data and mount one role-aware event
bridge above the routed pages. The bridge receives lightweight realtime event
documents and invalidates only the affected query families.

This is the selected approach. It preserves data while route components are
unmounted, receives change signals while their pages are inactive, and keeps
the amount of live data small.

### 2. Page-local query caches only

This would avoid repeated reads inside the freshness window, but an unmounted
page could miss a realtime event and show old data until the 15-minute fallback
refresh. It is insufficient for cross-account freshness.

### 3. Keep all Office pages mounted

This preserves local state but retains component trees, memory, timers, and
collection listeners for every visited page. It also leaves inconsistent data
loading patterns in place. This approach is rejected.

## Current-System Findings

Verified against the working tree on 2026-08-15.

- `AnimatedRoutes` keys its `Routes` element by `location.pathname`, so routed
  page elements are replaced on navigation and page-local state does not survive
  tab switching.
- `OfficeDashboard` rebuilds the weekly dashboard on mount from one
  `office-weekly-dashboard` read. That read takes **no week or range parameter**;
  the visible week and every filter (search, grade, teacher, weekday) are derived
  on the client from the same payload.
- `Academic` fetches **one broad payload** from the `office-academic` read
  channel with only a `limit`, then performs class selection, visibility
  filtering, and every summary derivation on the client.
- `Teachers` refetches `office-teachers-month` for its selected month, and
  `TeacherAttendance` refetches `teacher-attendance-week` for its `from`/`to`
  range, after remounting. Both parameters are genuine server parameters.
- `Admissions` mixes mount reads with a classes listener and is the only Office
  page already consuming an invalidation signal.
- `Classes` and `ClassDetail` combine one-time reads, module caching, and several
  listeners; their independently changing domains are not consistently cached.
- `Students` already has a 15-minute, identity-scoped TanStack Query design with
  a **30-minute** `gcTime`. It is the reference behavior, and its constants set
  the shared default for this design.
- The accounting reference and payroll query modules use the same 15-minute /
  30-minute pair, so three independent modules already agree on that policy.
- `StudentProfilePage` repeats its report and support reads on mount.
- Course-closing already uses TanStack Query with three different policies, one
  of which is a **signed URL** query holding an `expiresAt` and deliberately
  using `gcTime: 0`.
- Teacher availability keeps three broad collection listeners open while
  mounted; print support keeps two.
- Password reset is realtime, but it loses its last snapshot on remount.
- The Office view of the system page loads only settings-related data rather
  than the administrative bulk summary.
- Profile data already comes from the authentication context and does not need
  a new page query.
- The client realtime-event union in `src/hooks/useInvalidationRefresh.ts` is
  missing `print-requests`, which the server registry already emits. The hook
  also refreshes on *any* snapshot after the first rather than on a version
  increase.
- `firestore.rules` allows every authenticated active user to read
  `realtime_events/*`, so new event keys require **no rules change**.
- The shared `QueryClient` is created without `defaultOptions`; every existing
  cached module supplies its own options.
- Sign-out navigates with a full page load, which already clears the cache. An
  explicit clear is still required so the behavior is testable and so any
  non-reload identity change is covered.
- `ManagementTabs` is pure navigation and owns no data.

## Architecture

The design has three layers:

1. **Domain query modules** define stable keys, fetchers, options, and targeted
   cache helpers for Office data.
2. **Office pages** render query data and retain page-specific UI state. They do
   not own the lifetime of fetched domain data.
3. **Office invalidation bridge** lives in the persistent app shell for the
   duration of an authenticated Office or Admin session. Admin is included
   because the migrated `/academic`, `/teachers`, `/teacher-attendance`, and
   `/classes` views are shared with Admin. It converts lightweight realtime
   event versions into precise TanStack Query invalidations.

The application continues to use a shared `QueryClient`. Route unmounting only
removes observers; cached data remains available until its garbage-collection
window expires.

Query options stay **per module**, following the existing convention. No global
`defaultOptions` are introduced, because the same `QueryClient` also serves
parent, teacher, and accounting queries whose policies must not change silently.

## Cache Policy

Unless an exception below applies, Office domain queries use the following
defaults, which are the same constants the student directory, accounting
reference, and payroll modules already use:

- `staleTime`: **15 minutes**.
- Active-page background revalidation: **every 15 minutes**, via
  `refetchInterval` with `refetchIntervalInBackground: false`.
- Hidden browser tabs do not poll or run the fallback interval.
- Remount within 15 minutes uses cached data without a network request.
- `gcTime`: **30 minutes** after the last observer is removed.
- Stale data stays visible while a background request runs.
- A relevant realtime event or successful mutation invalidates immediately,
  independent of `staleTime`.
- Cache remains memory-only and is cleared on sign-out or authenticated identity
  change.

The 15-minute interval is a safety fallback, not the primary propagation path.
Mutation and realtime event invalidation provide normal freshness.

### Documented exceptions

- **Expiring resources.** Any query whose response is a signed URL or other
  credential carrying its own expiry keeps a short `staleTime` and `gcTime: 0`.
  The course-closing record file query is the known case; caching it under the
  shared policy would serve expired URLs.
- **Free-text search keys.** A query keyed by user-typed search text must debounce
  the input before it reaches the key, and uses a shorter `gcTime` than the
  default so that abandoned search strings do not accumulate for the full window.
- **Realtime-owned views.** Password resets stay realtime and are governed by the
  snapshot-seeding rule in the route section, not by this policy.

## Query-Key Rules

Keys are **domain-first**, then identity, then parameters:

```ts
[domain, uid, role, ...parameters]
```

This matches the keys already in the codebase, such as the student directory
roster key and the course-closing records key. There is deliberately **no literal
`office` namespace segment**: ten of the sixteen Office-reachable routes are also
served to `admin`, `teacher`, or `accounting`, and a role-named namespace would
either fork one page's cache per role or force role-conditional key construction.
The `uid` and `role` segments already provide identity and projection isolation.

Parameters must include every value capable of changing the **server** response,
such as month, week range, class ID, student ID, and server-side filters.
Structured parameters must be normalized so equivalent views produce the same
key.

Values that only reshape already-fetched data on the client — search text applied
in-memory, chip filters, sort order, view mode, expanded rows — must **not** enter
the key. Putting them in the key produces duplicate cache entries and duplicate
identical requests.

Prefix invalidation is allowed only when a whole **domain** is known to have
changed. Invalidating a role-wide or app-wide namespace is not permitted; it
would recreate the bulk-read problem this design exists to remove. When an event
has a target ID, the bridge should invalidate the narrowest matching detail and
the affected aggregate keys.

## Office Invalidation Bridge

The bridge mounts in the persistent app shell only for an authenticated
`office` or `admin` session. Admin must receive the same signals for the shared
Office pages; otherwise its identity-scoped copies of those queries can remain
stale for 15 minutes. Other roles create no bridge listeners. The bridge listens
to versioned realtime event documents, not to the full business collections.

It is implemented as a **new module** rather than as a modification of the shared
`useInvalidationRefresh` hook, which is also used by pages belonging to other
roles and must keep its current semantics.

Bridge behavior:

- Record the first observed version for each event key without invalidating;
  the initial snapshot is synchronization, not a new event.
- Compare the document's `version` field and act only on an increase. Ignore
  snapshots that change only local metadata.
- On a version increase, map the event key to exact query prefixes.
- Active matching queries refetch in the background.
- Inactive matching queries are marked stale and refetch when next observed;
  they are not eagerly loaded while their pages are closed.
- Coalesce bursts of related events in a short debounce window so a multi-write
  operation does not cause duplicate requests.
- Use an optional target ID to narrow invalidation where possible. Fall back to
  a domain prefix when the affected records cannot be determined safely.
- Tear down listeners and clear the previous identity's cached Office data on
  sign-out or identity change, in addition to the full page load that sign-out
  already performs.

The client event key union must be extended to cover every event an Office
session needs. It is currently missing `print-requests`, which the server
registry already emits, and it must also gain the two new event keys below.
Firestore rules already permit these reads, so no rules change is required.

## Event Taxonomy and Mapping

Realtime **event keys** are documents under `realtime_events/`. They are a
different registry from read **channels** under `/api/read/`, and the two must
not be confused; the new event names below are chosen so that they cannot be.

Existing event keys remain the source for their current domains:

| Event | Query families affected |
|---|---|
| `students` | dashboard counts, academic rosters, class counts, student directory, class roster, student profile |
| `admissions` | admissions pending/history summaries |
| `teacher-attendance` | attendance weeks, teacher month summaries, class session views |
| `teacher-availability` | teacher availability |
| `assignments` / `submissions` | class detail work and dependent aggregates |
| `course-closing` | academic closing data and course-closing records |
| `print-requests` | print-support full list and the persistent pending badge |

Two narrow Office events are added to cover currently disconnected aggregates:

### `office-schedule-changed`

Emitted after committed changes to classes, schedules, rooms, assigned teachers,
make-up/cancelled sessions, substitute assignments, teacher reference data, or
holidays. It invalidates the Office dashboard, teacher month summaries, teacher
attendance, and class-list schedule/reference queries.

### `office-academic-changed`

Emitted after committed changes to evaluations/comments, course-closing data,
fee ledgers, notices, or exemptions. It invalidates academic queries and
affected student-profile reports.

Server handlers must touch an event only after the underlying business writes
commit successfully. An event is a refresh signal, not a second source of
business truth.

## Route-by-Route Design

All sixteen Office-reachable routes are covered, including the three direct
routes absent from the sidebar (`/classes/:classId`, `/students/:studentId`,
`/admin`).

### `/office-dashboard`

Cache the complete weekly center schedule projection, teacher references, and
derived counts as **one parameterless query**. The underlying read accepts no
week or range parameter, and the visible week, search text, grade, teacher, and
weekday filters are all client-side derivations of the same payload, so none of
them may enter the key. This page is the natural default route and needs no
additional eager prefetch.

Invalidation: `office-schedule-changed`, `students`, and any attendance event
that changes displayed schedule status.

### `/academic`

Cache the existing single academic payload under one identity-scoped key,
preserving the current client-side visibility filtering and class selection.
This removes the repeated bulk read on remount, which is the goal of this
project.

Splitting the payload into an overview query and a selected-class detail query
is **deferred**. It cannot be done on the client alone, and doing it on the
server would change the read channel's projection, which the Non-goals exclude.
It is recorded here as follow-up work with its own design, not as a task in this
rollout.

Invalidation: `office-academic-changed`, `course-closing`, and `students`.

### `/admissions`

Separate pending admissions, admission history, and class references. Preserve
history pagination cursors in the key and cache previously visited pages.

Invalidation: `admissions`; class-reference data also responds to
`office-schedule-changed` when needed.

### `/teachers`

Key teacher summaries by the selected month, which is a genuine server
parameter. Returning to an already viewed month should be instant during its
freshness window.

Invalidation: `office-schedule-changed` and `teacher-attendance`.

### `/teacher-attendance`

Key attendance by normalized `from` and `to` dates, which are genuine server
parameters. A deterministic mark action updates the affected cached row
optimistically, rolls back on failure, and invalidates the week after success
for background verification.

Invalidation: `teacher-attendance` and schedule changes that alter the sessions
within the range.

### `/teacher-availability`

Replace the three broad page-owned listeners with cached query families and the
lightweight event signal. Queries are separated where their source data has a
different invalidation lifecycle.

Invalidation: `teacher-availability`; teacher/class reference portions can also
respond to `office-schedule-changed`.

### `/classes`

Separate class data, teacher references, holidays, and derived student counts.
Do not force all four sources to reload when only one changes.

Invalidation: `office-schedule-changed`, `students`, and targeted holiday/class
events.

### `/classes/:classId`

Use independent class-scoped queries for class metadata, roster, evaluations,
assignments, submissions, and sessions. A change to one domain must not discard
all other successful detail data.

Invalidation: target-aware `students`, `office-academic-changed`, `assignments`,
`submissions`, `teacher-attendance`, and `office-schedule-changed` events.

### `/students`

Retain the existing identity-scoped student directory queries, their keys, and
their 15-minute / 30-minute policy unchanged. Integrate them with the Office
invalidation bridge rather than replacing them.

Invalidation: `students` and the existing finance-related invalidations for
ledger-backed fields.

### `/students/:studentId`

Key the generated student report by student ID and all **server** report
parameters. Move shared support/reference reads into reusable queries so
navigating among students does not reload unchanged reference data.

Invalidation: target-aware `students`, `office-academic-changed`, assignments,
submissions, and finance/ledger events where they affect the report.

### `/course-closing-records`

Keep the existing TanStack Query implementation, retain identity scoping, and
connect it to the bridge. Normalize the month and records queries to the shared
15-minute policy, with two exceptions:

- the record **file** query keeps its short `staleTime` and `gcTime: 0`, because
  it returns a signed URL with its own expiry; and
- the records query debounces its search text before it reaches the key and uses
  a shorter `gcTime`, so abandoned searches do not accumulate.

Invalidation: `course-closing` and applicable `office-academic-changed` changes.

### `/print-support`

Retain the small persistent app-shell listener used for the pending badge. Move
the full request list to a cached query so opening the page does not establish a
new broad listener on every visit.

Invalidation: `print-requests`, which must first be added to the client event key
union.

### `/password-resets`

Retain realtime behavior because request status is operationally sensitive, but
seed/remount the view from its last in-memory snapshot. Reopening the page must
not flash an empty full-page loader while the listener reconnects.

### `/admin` for Office

Cache only settings and holiday/reference data accessible to Office. Do not
activate or prefetch administrator-only bulk queries; the page already branches
on role before loading them.

Invalidation: the corresponding settings or `office-schedule-changed` event.

### `/profile`

Continue reading the authenticated profile from `AuthContext`; no page query is
added. A profile mutation updates the context/cache and verifies in the
background.

### `/`

This route redirects Office users to the dashboard and owns no query.

## Mutation Semantics

- Deterministic, localized results use optimistic cache updates with a captured
  previous value and rollback on failure.
- Mutations spanning multiple collections keep current cached data visible and
  invalidate affected query families only after successful completion.
- Server-side writes emit their realtime event only after commit.
- The initiating client may update or invalidate immediately; the subsequent
  event is safe because burst coalescing prevents duplicate refetches.
- Manual refresh invalidates only the visible query family. It is disabled or
  guarded while the same refresh is already in flight.
- Mutation progress is scoped to the affected row, request, student, or class;
  it must not block the entire page unnecessarily.

## Loading, Refresh, and Error UX

- **No cached data:** show the existing skeleton or full initial loading state.
- **Fresh cached data:** render immediately with no spinner and no network read.
- **Stale/background refresh:** keep cached content visible and show only a
  subtle refresh indicator or status text.
- **Background refresh failure:** keep cached content visible, mark it as
  potentially stale, and provide a retry action.
- **Failure with no successful data:** show the full error state.
- **Mutation in progress:** indicate only the affected control or record.

Durable navigation choices such as month, week, selected class, tab, and filter
currently live in component state. Because the query cache survives unmounting,
these selections reset to their defaults on remount while the underlying data
stays cached, which is an improvement over the current behavior but not a
complete one. Moving those selections into the URL is **optional follow-up work**
with its own tasks and tests; it is not required by, and must not be bundled
with, the cache migration.

## Testing Strategy

Integration tests must reuse the same `QueryClient` across route unmount and
remount so they verify actual navigation behavior. Fake timers should make the
15-minute boundaries deterministic.

Required coverage:

- remount within 15 minutes causes zero repeated reads;
- an active query revalidates at 15 minutes;
- a hidden document does not run fallback polling;
- a realtime event refetches active queries and only marks inactive queries
  stale;
- a snapshot without a version increase does not invalidate;
- month, week, class, student, and pagination parameters produce independent
  cache entries;
- client-only filters and search text produce **no** additional cache entries and
  no additional requests;
- `uid` and role changes cannot reuse another identity's cached data;
- cached content remains rendered during a background request and failure;
- optimistic mutations roll back after an error;
- event bursts are coalesced;
- manual refresh cannot issue duplicate concurrent reads; and
- event target IDs narrow invalidation without leaving known aggregates stale.

Each migrated page also retains its existing business and permission tests.
Every workstream must pass focused tests, TypeScript checking, and the full
Vitest suite before integration. TypeScript checking is not optional: it is the
only gate in this repository that catches contract breakage a green test run can
hide.

## Rollout Plan

Implementation is divided into three independently testable workstreams. Each
workstream should use separate, reviewable commits.

### Workstream 1: foundation and high-frequency schedule pages

- shared Office query policy and key helpers;
- client event key union extension and the app-shell invalidation bridge module;
- explicit cache clear on sign-out and identity change;
- Office dashboard;
- academic single-payload caching;
- teachers; and
- teacher attendance.

### Workstream 2: student and class workflows

- admissions;
- classes;
- class detail;
- student profile; and
- integration of the already optimized student directory.

### Workstream 3: operational and lower-frequency routes

- teacher availability;
- course-closing normalization with its two documented exceptions;
- print support;
- password resets;
- Office system/settings; and
- profile mutation integration.

The bridge foundation lands before page migrations that depend on it. Within a
workstream, query modules and tests should land with the page that consumes
them. No rollout step should require all three workstreams to be deployed at
once.

## Success Criteria

- Switching among previously opened Office pages within 15 minutes performs
  zero new bulk reads for unchanged query families.
- A page with cached data never returns to a full loading state solely because
  the route was remounted.
- Relevant changes made by another account reach Office sessions and Admin
  sessions using the shared Office pages through an event without requiring a
  browser refresh.
- Active fallback refresh occurs every 15 minutes, while hidden tabs do not
  poll.
- Broad page-owned **collection** listeners decrease. The bridge adds at most one
  single-document listener per event key, multiplexed over the existing Firestore
  channel, and those are bounded by the size of the event registry.
- Cache data is never shared across users or roles.
- Existing permissions, projections, and business results remain unchanged.

## Risks and Mitigations

### Missed invalidation source

A mutation that does not emit an event can leave inactive cached data fresh
until the fallback boundary. Inventory every writer for each migrated domain,
test event emission after successful commits, and keep the 15-minute active
fallback.

### Over-broad invalidation

Invalidating a role-wide namespace would recreate the current bulk-read problem.
Centralize the event-to-query mapping, use target IDs where available, and test
unrelated query families for zero requests.

### Duplicate event and local invalidation

The initiating client can see both its own mutation completion and the server
event. Coalesce event bursts and rely on TanStack Query request deduplication,
while preserving immediate optimistic feedback.

### Cache-key omissions and over-inclusions

If a response-shaping parameter is absent from the key, pages can display the
wrong period or entity. If a client-only filter is present in the key, the page
issues duplicate identical requests and quietly loses the benefit of the cache.
Define key factories beside the fetchers and test both directions: independence
for every server parameter, and zero extra entries for every client filter.

### Memory growth

Parameterized queries can accumulate during long Office sessions. The 30-minute
`gcTime`, the search-text exception, paginated key discipline, and the absence of
eager whole-app prefetch bound memory use while preserving useful revisit
behavior.

### Concurrent migration work

Some query areas may already be changing independently. Implement each domain
against the latest code, preserve unrelated working-tree changes, and avoid
combining broad refactors with cache migration commits.

## Observability During Rollout

Use existing request logging and test spies to compare request counts before
and after migration. During staged verification, record at least:

- first-open request count;
- revisit request count before and after 15 minutes;
- event-to-visible-update latency;
- duplicate requests following a mutation; and
- active broad listener count for migrated pages.

Unexpected increases block expansion to the next workstream until the event
mapping or key boundary is corrected.

## Deferred Follow-up Work

Recorded here so it is not silently lost, and explicitly out of scope for this
rollout:

- splitting the `/academic` payload into overview and class-detail server
  projections; and
- moving durable navigation selections (month, week, selected class, tab) into
  the URL.
