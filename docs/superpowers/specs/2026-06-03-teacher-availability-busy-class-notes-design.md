# Teacher Availability Busy Class Notes Design

## Status

Approved for planning by the user on 2026-06-03.

## Context

The `TeacherAvailability` page is visible to teachers, admins, and office users. Admin and office users currently see an "Approved availability" table that groups approved teacher availability by weekday. Each teacher name is rendered as a button; selecting it opens the teacher's availability grid.

The user wants admin and office users to see, directly next to a teacher's name, whether that teacher already has an active class during the availability time shown for that day.

## Scope

Add busy-class notes to teacher name buttons in the admin/office "Approved availability" table.

The note format is:

```text
Đã có lớp: Class name - 17:00 - 18:30
```

When multiple classes match for the same teacher and weekday, join them in one note:

```text
Đã có lớp: Class A - 17:00 - 18:30; Class B - 19:00 - 20:30
```

Teacher-facing availability editing behavior is unchanged.

## Data Rules

Busy notes use existing `classes` documents and approved availability profiles.

A class counts as busy only when all of these are true:

- `class.status === 'active'`.
- The class is currently effective in Vietnam time.
- If `startDate` is present, today must be on or after `startDate`.
- If `endDate` is present, today must be on or before `endDate`.
- The class `teacherId` matches the availability profile `teacherId`.
- The class `daysOfWeek` includes the weekday being rendered.
- The class time range overlaps at least one availability slot that the teacher selected for that weekday.

Time overlap does not require exact equality. A class overlaps an availability slot when:

```text
classStart < slotEnd && classEnd > slotStart
```

Classes with invalid or missing parseable time ranges are ignored for busy-note calculation.

The displayed class time range comes from the class schedule itself, not the availability slot. Use the same behavior as the existing class schedule utilities: parse an explicit range from `class.schedule` when present, otherwise use `class.startTime` with the existing 90-minute fallback. The display text should preserve the actual class range, for example `17:00 - 18:30`.

## Architecture

Use a small domain helper rather than embedding the time and class filtering logic directly in the component.

Helper location:

```text
src/lib/availability/teacherBusyNotes.ts
```

The helper should accept:

- classes
- availability slots
- teacher availability selections
- teacher id
- weekday key
- current date string, defaulting to Vietnam today

The helper should return a stable, de-duplicated list of busy class notes, sorted by start time and then class name:

```ts
type TeacherBusyClassNote = {
  classId: string;
  className: string;
  timeRange: string;
};
```

The UI component will format those notes into the Vietnamese badge text.

`TeacherAvailability.tsx` will subscribe to `classes` only for reviewer users (`admin` and `office`). It should follow the existing frontend collection limit pattern and leave teacher users unaffected.

## UI Behavior

In the `Approved availability` table, each teacher button keeps its current click behavior and active styling.

When the helper returns one or more busy notes for that teacher and day, the button shows:

```text
Teacher Name
Đã có lớp: Class name - 17:00 - 18:30
```

The note should appear as a compact secondary line or badge inside the teacher button. If no busy classes match, the button looks like it does today.

If class loading fails, the availability table remains usable. The page logs the error and simply omits busy notes until class data is available.

## Testing

Add helper tests for:

- Overlap detection when class time partially overlaps an availability slot.
- No note when class time is on the same day but outside the selected availability slot.
- No note for `paused` classes.
- No note for `archived` classes.
- No note for active classes before `startDate`.
- No note for active classes after `endDate`.
- Note for active classes inside the effective date range.
- Multiple busy classes joined in stable order.
- Invalid or missing class time ranges are ignored.

Add `TeacherAvailability` UI test coverage for office/admin reviewer view:

- A teacher with an overlapping active class shows `Đã có lớp: Class name - 17:00 - 18:30`.
- Multiple matching classes render in one note separated by `;`.
- Teachers without matching busy classes still render with the existing name-only button.

## Out Of Scope

This design does not block teachers from saving availability that overlaps existing classes.

This design does not change class creation or editing validation.

This design does not add a server API for availability summaries.
