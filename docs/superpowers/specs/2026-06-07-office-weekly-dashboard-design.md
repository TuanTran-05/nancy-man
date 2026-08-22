# Office Weekly Dashboard Design

## Status

Approved on 2026-06-07. The chosen direction is layout A from the visual companion: a fixed Monday-to-Sunday weekly board for office users.

## Goal

Build a dedicated Office Dashboard page that lets office staff scan the recurring weekly class schedule and quickly understand class placement capacity by day, teacher, grade, course dates, and active/on-leave student counts.

## User Decisions

- The board is fixed by weekday. It does not have week navigation.
- The page shows Monday through Sunday as persistent columns.
- A class remains visible after its course end date as long as the class record is still visible to office users.
- Ended classes get a visible `ended course` badge. They are not hidden automatically.
- Archived or hidden class records are not shown.
- Filters support multiple values at once for teacher, weekday, and grade.
- Grade filtering should prefer the class `grade` field and fall back to the existing grade inference from class names such as `G5`, `Grade 5`, `khoi 5`, or numeric class names.
- The page must support Vietnamese and English.
- All user-facing text must come from the existing translation module. Components must not hardcode bilingual copy or translate strings locally in frontend logic.

## UX

The first screen is the dashboard itself, not a landing page. It uses the existing EduTrack product style: light surface, slate text, blue accent, compact cards, lucide icons already present in the project, and restrained motion.

The top area contains:

- Page title and short subtitle from `t.officeDashboardPage`.
- Quick metrics:
  - visible classes
  - active students
  - on-leave students
  - ended courses
- Search input for class or teacher names.
- Multi-select filters for teachers, weekdays, and grades.
- A reset filters action.

The main board contains seven columns:

- Monday
- Tuesday
- Wednesday
- Thursday
- Friday
- Saturday
- Sunday

Each class card shows:

- class name
- start time or schedule
- teacher name
- grade
- room when available
- course start date
- course end date
- current total, defined as `active + onLeave`
- active count
- on-leave count
- status badge: active, new course, ending soon, or ended course

Empty days show a compact translated empty state.

## Data Rules

The backend should expose a dedicated read channel, `office-weekly-dashboard`, instead of making the page stitch together broad `classes`, `students`, and `users` reads on the client.

The channel returns only data needed by this page:

- class schedule metadata
- teacher display metadata
- grade
- student counts per class
- server time

Student counts are strict:

- `active`: students whose `enrollmentStatus` is missing or `active`, excluding archived and trial lifecycle records
- `onLeave`: students whose `enrollmentStatus` is `on_leave`, excluding archived and trial lifecycle records
- `currentTotal`: `active + onLeave`

Ended course status is computed on the client from backend data and server time. If a class has `terms`, the active term is selected when today's date falls inside it. If no current term exists, the next upcoming term is selected. If no upcoming term exists, the latest ended term is selected. If there are no terms, the class `startDate` and `endDate` are used.

`endingSoon` means the selected course end date is within 14 days from the server date and is not already ended.

## Architecture

Add a small backend read channel for safe, bounded data retrieval. Add a client API wrapper, a pure board builder/filter helper, and a page component.

Keep data derivation separate from rendering:

- backend read channel: authorization and compact payload
- `src/lib/office/weeklyDashboard.ts`: weekday grouping, term selection, status calculation, sorting, and filters
- `src/pages/office/OfficeDashboard.tsx`: page state and rendering

The route should make the office role land on this page from `/`, with a direct route such as `/office-dashboard`. The office sidebar should place Dashboard first.

## Error Handling

The page has:

- loading skeleton
- translated load error state
- retry button
- translated empty board state
- translated no-results state when filters remove all cards

Backend errors follow the existing read API pattern with `jsonError` and `requireRole`.

## Internationalization

All visible strings must be added to:

- `src/lib/i18n/locales/vi/pages.ts`
- `src/lib/i18n/locales/en/pages.ts`

The page must read copy through `useLanguage()` and `t.officeDashboardPage`.

The component must not:

- inline Vietnamese strings
- inline English strings
- derive English labels from Vietnamese labels
- call browser translation APIs
- use conditional copy such as `language === 'vi' ? '...' : '...'` for user-facing text

Conditional formatting may select locale codes for date formatting, but labels and text must come from translation data.

## Testing

Backend tests should verify:

- office users can read the channel
- non-office users are rejected
- archived classes are hidden
- ended active classes remain visible
- active and on-leave counts are computed correctly
- grade is returned from field or inferred from name

Pure helper tests should verify:

- Monday through Sunday grouping
- Sunday `daysOfWeek: 0`
- ended classes still produce cards
- ended and ending-soon status badges
- multi-select filter intersections
- search over class and teacher names

UI tests should verify:

- Vietnamese copy renders from `translations.vi.officeDashboardPage`
- English copy renders from `translations.en.officeDashboardPage`
- no user-facing copy is asserted as locally translated fallback
- multi-select filters can select several teachers, weekdays, and grades
- reset filters restores the full board
- ended classes show the ended-course badge

## Out Of Scope

- Week navigation.
- Editing classes from this dashboard.
- Drag-and-drop class placement.
- Teacher substitute or attendance state.
- Including trial students in the requested counts.
- Finance or tuition data.

## Spec Review

- Incomplete markers: none.
- Contradictions: none. Ended classes remain visible; archived classes are hidden.
- Scope: one cohesive feature with backend payload, pure data builder, route, UI, i18n, and tests.
- Ambiguity resolved: grade fallback uses the existing `getClassGrade` behavior already present in the server auth utility.
