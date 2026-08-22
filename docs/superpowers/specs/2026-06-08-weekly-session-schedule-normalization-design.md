# Weekly Session Schedule Normalization Design

## Goal

Support classes that meet multiple times per week at different times, while making the schedule
model easier to extend later.

The current model stores `daysOfWeek[]` plus one class-level `startTime` and one class-level
`schedule`. That can represent "Monday and Wednesday at the same time", but it cannot represent
"Monday 17:30-19:00 and Wednesday 19:15-20:45" without losing structured data.

## Product Decisions

- A class remains one class, even when its weekly sessions happen at different times.
- A class has at most one regular session per weekday.
- A regular weekly session is defined by weekday, start time, end time, and optional room override.
- Existing classes keep working without migration before release. If `weeklySessions` is missing,
  the app derives one session per `daysOfWeek` entry from legacy `startTime`, `schedule`, and
  `room`.
- `class_sessions/{classId}_{date}` remains the persisted per-date session document. Its document
  id does not change because the product still has only one regular class session per class date.
- Makeup sessions and cancelled sessions continue to live in `class_sessions`.
- Payroll, teacher attendance, office dashboards, calendar, student/teacher/parent dashboards,
  and teacher availability must resolve time through the same shared helper.
- New writes should save canonical structured schedule data. Legacy display fields stay as
  compatibility fields during the transition.

## Recommended Approach

Add a normalized `weeklySessions` array to class documents:

```ts
type WeeklyClassSession = {
  dayOfWeek: number; // 0 Sunday, 1 Monday, ..., 6 Saturday
  startTime: string; // API time-only, HH:mm:ss
  endTime: string; // API time-only, HH:mm:ss
  room?: string;
};

interface Class {
  weeklySessions?: WeeklyClassSession[];

  // Legacy compatibility fields.
  daysOfWeek: number[];
  startTime: string;
  schedule: string;
  room?: string;
}
```

`weeklySessions` is the canonical schedule when present. `daysOfWeek`, `startTime`, and `schedule`
stay readable and writable for compatibility, imports, old documents, and screens not yet migrated.
New class creates/updates should keep legacy fields synchronized from `weeklySessions`:

- `daysOfWeek`: sorted unique `weeklySessions[].dayOfWeek`
- `startTime`: first session start time by weekday then time
- `schedule`: the first session time range only, for legacy parsers that still expect one range

The important rule is that business logic must not parse `schedule` when `weeklySessions` exists.
Multi-session display text should come from the new shared helper, not from the legacy `schedule`
field.

## Shared Schedule API

Create shared helpers in `shared/classSchedule.ts` or a nearby module:

```ts
type ResolvedClassSessionTime = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  schedule: string;
  room?: string;
  source: 'weeklySessions' | 'legacy';
};

function getWeeklyClassSessions(cls: SchedulableClass): ResolvedClassSessionTime[];
function getClassSessionForDate(cls: SchedulableClass, date: string): ResolvedClassSessionTime | null;
function getClassTimeRangeForDate(cls: SchedulableClass, date: string): string;
function formatWeeklyClassSchedule(cls: SchedulableClass): string;
function getScheduledClassDatesInRange(cls: SchedulableClass, from: string, to: string): string[];
function isScheduledClassDate(cls: SchedulableClass, date: string): boolean;
```

`getWeeklyClassSessions()` normalizes both new and legacy models. It validates weekdays, normalizes
time display, filters invalid entries, sorts by weekday then start time, and falls back to legacy
fields only when `weeklySessions` has no valid entries.

`getScheduledClassDatesInRange()` and `isScheduledClassDate()` should use resolved weekly sessions
instead of directly reading `daysOfWeek`. This keeps date generation behavior unchanged for legacy
classes while enabling the new model.

## Write Path

Update class create/update validation and payload building:

- Accept optional `weeklySessions`.
- Validate each item:
  - `dayOfWeek` is an integer from 0 to 6.
  - `startTime` and `endTime` are API time-only values.
  - `endTime` is after `startTime`.
  - duplicate `dayOfWeek` entries are rejected.
  - `room` is optional and length-limited.
- Normalize user-entered times before calling the API.
- Derive legacy compatibility fields from normalized sessions.

For old forms or API callers that do not send `weeklySessions`, keep the existing behavior:
normalize `daysOfWeek`, `startTime`, and `schedule`, then optionally derive `weeklySessions` server
side only if both start and end time can be resolved safely. If an end time cannot be resolved,
leave `weeklySessions` absent and use the legacy fallback helper.

## UI Design

In the class modal, replace the single "week days + schedule + start time" section with a compact
weekly session editor:

- Add one row per weekly session.
- Each row has weekday, start time, end time, and optional room.
- Prevent duplicate weekday selections in the UI.
- Keep a simple default flow: when creating a new class, start with one row; adding a second row is
  explicit.
- When editing a legacy class, prefill rows by resolving legacy data. If legacy parsing cannot
  produce an end time, use the existing 90-minute fallback.

List/detail screens should display a concise multi-session schedule, for example:

```text
Mon 17:30-19:00 | Wed 19:15-20:45
```

Compact cards can show the date-specific time when rendered inside a specific weekday/date context.

## Read Path And Consumers

Every consumer that currently uses `daysOfWeek`, `startTime`, or `schedule` for session logic should
move to the shared helper:

- Office weekly dashboard cards: resolve time for each weekday card.
- Office teacher month schedule: resolve time for each generated date.
- Teacher attendance read rows: resolve schedule for each row date.
- Calendar page: resolve time for each date and sort by resolved start time.
- Teacher dashboard upcoming classes: resolve time per upcoming date.
- Student dashboard today schedule: resolve today's session time.
- Parent dashboard schedule/heatmap remains date-driven, but any time labels should use resolved
  date-specific time.
- Teacher availability busy notes: check overlap against the resolved session for that weekday.
- Teacher payroll session lists: display the resolved date-specific time.
- Face attendance time-window logic: compare against today's resolved start time.

API projections that return class rows should include `weeklySessions` wherever a consumer needs
schedule logic. Finance-only fields should remain protected as they are today.

## Data Flow

1. Admin/office creates or edits a class in the class modal.
2. The form sends normalized `weeklySessions`.
3. The server validates `weeklySessions`, derives compatibility fields, and stores
   `weeklySessions`, `daysOfWeek`, `startTime`, `schedule`, and
   legacy finance/class fields.
4. Read APIs return `weeklySessions` in schedule-aware projections.
5. UI and backend logic call shared helpers to resolve a session for a specific date or weekday.
6. `class_sessions` remains the per-date override/attendance/makeup/cancelled record.

## Error Handling

- Reject duplicate weekdays with a clear API validation error.
- Reject invalid or reversed time ranges.
- If a class has no valid `weeklySessions` and no valid legacy schedule, treat it as unscheduled
  instead of fabricating dates.
- If a legacy `schedule` string cannot be parsed, keep the current 90-minute fallback from
  `startTime` where existing helpers already do this.
- If a screen receives invalid schedule data, it should show `--:--` but avoid crashing.

## Migration Strategy

No immediate Firestore migration is required for correctness because helpers support both models.

Implementation should still include a one-off script later to backfill `weeklySessions` for classes
whose legacy data is parseable. The script should be idempotent, report skipped classes, and avoid
changing documents with existing `weeklySessions`.

## Testing

Add focused tests before implementation:

- Shared schedule helper tests:
  - resolves legacy single-time classes exactly as today;
  - resolves `weeklySessions` with different Monday/Wednesday times;
  - date range generation uses `weeklySessions`;
  - invalid sessions are ignored or rejected depending on helper vs API context;
  - display formatting sorts by weekday then time.
- API validation tests for class create/update:
  - accepts valid `weeklySessions`;
  - rejects duplicate weekday;
  - rejects end time before start time;
  - preserves legacy-only payload compatibility.
- Office dashboard and teacher schedule tests:
  - same class appears on two weekdays with different displayed/sorted times.
- Teacher attendance read tests:
  - virtual rows use the date-specific time.
- Teacher availability busy-note tests:
  - overlap is checked against the selected weekday's time, not the first class time.
- Face attendance tests:
  - today's allowed window uses the resolved session start time.

## Rollout Plan

1. Add shared normalized schedule helpers and tests.
2. Add class type, API validation, and server payload support.
3. Update class create/edit UI to edit `weeklySessions`.
4. Update read API projections and high-impact consumers.
5. Update remaining display-only consumers.
6. Add optional backfill script after behavior is stable.

## Non-Goals

- Do not support two regular sessions for the same class on the same date in this phase.
- Do not change class enrollment, tuition, or payroll rates per session.
- Do not change the `class_sessions` document id format.
- Do not redesign office dashboard or calendar layouts beyond the schedule controls/labels needed
  for correctness.
- Do not remove legacy fields until all external callers and old documents are accounted for.
