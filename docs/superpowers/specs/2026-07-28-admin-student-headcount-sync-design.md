# Admin student headcount synchronization

## Problem

The Students page reports the current canonical roster from the live student
directory, while the Admin Dashboard prefers the cached
`read_models/dashboard_global` counts. This allows the dashboard's active and
total counts to drift from the Students page until the daily aggregate job
runs. The two paths also disagree on whether an active trial student belongs
in the active/learning count.

## Considered approaches

1. Refresh the dashboard aggregate more frequently. This reduces the stale
   window but still permits disagreement and adds background workload.
2. Reject stale read models in the read endpoint. This improves freshness but
   requires an age policy and makes a dashboard read perform a full aggregate.
3. Derive the student KPI from the live directory already fetched by the Admin
   Dashboard, using one shared headcount definition. This is the smallest and
   most deterministic fix.

Approach 3 is selected. The aggregate will also use the same shared definition
so other aggregate consumers remain semantically consistent.

## Design

Add a shared helper beside `getCurrentStudentRoster` that returns:

- `total`: canonical roster size;
- `active`: lifecycle `enrolled` with enrollment status `active`;
- `trial`: lifecycle `trial`;
- `onLeave`: lifecycle `enrolled` with enrollment status `on_leave`.

The Students page will use this helper for its KPI strip. The Admin Dashboard
hook will calculate `studentsCount` and `activeStudentsTotal` from the live
directory response instead of the cached summary. Other dashboard projection
fields remain backed by the read model.

The dashboard aggregate service will use the shared helper for `currentStudents`
and `activeStudents`. Existing class-level counts are out of scope because they
represent per-record class membership rather than the global unique headcount.

## Error handling

No new network path is introduced. If the directory request fails, the existing
combined Dashboard load continues to use its current error path rather than
displaying mismatched cached student counts.

## Testing

- Shared helper tests cover enrolled active, enrolled on-leave, trial,
  archived/revoked, dropped, and promoted records.
- Aggregate tests include an active trial and assert that it contributes to
  total/trial but not active.
- Admin data-selection tests assert that a stale dashboard summary cannot
  override live-directory headcounts.
- Run focused tests, typecheck, and the production build.
