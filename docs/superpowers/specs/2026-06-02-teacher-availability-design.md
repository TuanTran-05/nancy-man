# Teacher Availability Registration Design

Date: 2026-06-02

## Goal

Add a weekly teacher availability feature without calendar dates. Teachers register recurring free teaching times from Monday through Sunday. The system stores availability by required day pairs, lets admin and office staff configure available time slots, and requires review before any later change takes effect.

## Confirmed Requirements

- Teachers select availability by required day pairs only:
  - Tuesday and Thursday
  - Wednesday and Friday
  - Saturday and Sunday
  - Sunday and Monday
- A selected slot applies to both days in its pair at the same time.
- Time slots are configurable by admin and office staff.
- Weekday teaching windows are Monday through Friday, 16:00 to 21:00.
- Saturday and Sunday can support full-day slots.
- The first saved availability profile is applied immediately.
- Any later teacher change creates a review request with a required reason.
- While a change request is pending, the previous approved availability remains effective.
- Admin and office staff can configure slots and approve or reject change requests.

## Data Model

### `teacher_availability_slots/{slotId}`

Configurable time slots shown in the weekly availability grid.

Fields:

- `label`: display label, such as `18:00-19:30`
- `startTime`: `HH:mm`
- `endTime`: `HH:mm`
- `allowedPairs`: list of pair keys where this slot may be used
- `active`: boolean
- `sortOrder`: number
- `createdAt`, `updatedAt`
- `createdBy`, `updatedBy`

Valid pair keys:

- `tue_thu`
- `wed_fri`
- `sat_sun`
- `sun_mon`

`allowedPairs` keeps the configurable-slot model compatible with different day windows. For example, full-day morning slots can be enabled for `sat_sun`, while `sun_mon` should only expose slots also valid on Monday.

### `teacher_availability_profiles/{teacherId}`

The currently effective availability for one teacher.

Fields:

- `teacherId`
- `teacherName`
- `selections`: list of `{ pairKey, slotId }`
- `selectionKeys`: list of stable keys like `tue_thu:slot-1800` for duplicate checks
- `version`: number, starting at `1`
- `createdAt`, `updatedAt`
- `createdBy`, `updatedBy`

This is the only source used for scheduling decisions. Pending requests do not modify this document.

### `teacher_availability_change_requests/{requestId}`

Pending or reviewed teacher requests to replace their effective availability.

Fields:

- `teacherId`
- `teacherName`
- `currentSelections`
- `requestedSelections`
- `reason`
- `status`: `pending`, `approved`, or `rejected`
- `reviewedBy`
- `reviewedByName`
- `reviewedAt`
- `reviewNote`
- `createdAt`, `updatedAt`

Only one pending request may exist per teacher.

## Backend Workflow

Add API actions under the existing classes API module:

- `save-availability`
- `review-availability-change`
- `save-availability-slot`

`save-availability` is teacher-only. It validates the teacher identity, normalizes selections, checks every slot is active and allowed for the selected pair, and rejects duplicate pair-slot entries. If no profile exists, it creates `teacher_availability_profiles/{teacherId}` immediately. If a profile already exists, it requires `reason`, rejects if a pending request already exists, and creates a `teacher_availability_change_requests` document.

`review-availability-change` is admin/office-only. Approving a pending request updates the teacher profile in a transaction, increments `version`, stores the requested selections, and marks the request approved. Rejecting leaves the profile unchanged and marks the request rejected with the review note.

`save-availability-slot` is admin/office-only. It creates or updates slot definitions and validates `HH:mm` ordering, `allowedPairs`, and active state.

## Firestore Rules

Client writes to all three availability collections are denied. Reads are allowed as follows:

- Teachers can read active slots, their own profile, and their own change requests.
- Admin and office can read slots, all profiles, and all change requests.
- Direct create/update/delete is denied so all mutations go through API validation.

## UI Design

Add route `/teacher-availability` for `teacher`, `admin`, and `office`.

Teacher view:

- Weekly grid from Monday to Sunday with no dates.
- Rows are active slots configured by admin/office.
- Selections are made by pair controls: `T3-T5`, `T4-T6`, `T7-CN`, `CN-T2`.
- Clicking a pair-slot marks both days visually.
- First save shows `Luu lich roi`.
- Later edits show a required reason field and submit as a review request.
- If a pending request exists, show the effective approved schedule and the pending requested schedule separately.

Admin/office view:

- Slot configuration tab: create, edit, deactivate, and order slots.
- Review tab: list pending availability change requests with teacher name, reason, current schedule, requested schedule, approve, reject, and review note.
- Profile overview: read current effective availability for teachers so staff can use it for scheduling.

## Integration Points

- Add a sidebar item for teacher, admin, and office roles.
- Add lazy route registration in `AnimatedRoutes`.
- Add TypeScript interfaces in `src/types.ts`.
- Add i18n keys in existing locale files, keeping edits scoped because the Vietnamese files currently use the repository's existing encoding style.
- Reuse existing `apiRequest`, Firebase snapshot patterns, `ProtectedRoute`, toast handling, and card/list styling from nearby pages such as substitute requests.
- Add realtime invalidation only if the existing client registry needs this route to refresh across sessions.

## Tests

API tests:

- first teacher save creates the profile immediately
- later teacher save creates a pending request instead of updating the profile
- later save requires reason
- duplicate pending request is rejected
- inactive slots and invalid pairs are rejected
- approve updates profile and closes request
- reject closes request and keeps profile unchanged
- admin and office can manage slots and review requests
- teacher cannot review or configure slots

Rules tests:

- teacher can read own profile and requests
- teacher cannot read another teacher's requests
- admin and office can read all availability data
- direct client writes are denied for slots, profiles, and requests

Frontend tests:

- teacher first-save flow submits selected pair slots
- teacher edit flow requires reason
- pending request state keeps approved schedule visible
- admin/office review actions render and call the expected API actions

## Migration Notes

No destructive migration is required. The new collections can be created lazily by API writes. If the center wants starter slots, add an idempotent migration under `scripts/migrations` to seed slot documents; the UI should not hard-code those starter slots.

## Non-Goals

- No date-specific availability.
- No automatic class assignment engine in this feature.
- No direct teacher edits after the first save without review.
- No scheduling effect from pending requests.
