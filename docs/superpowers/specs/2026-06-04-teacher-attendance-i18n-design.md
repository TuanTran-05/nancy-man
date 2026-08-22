# Teacher Attendance I18n Design

## Summary

Update the office `/teacher-attendance` page so all static UI copy comes from the existing translation module. Vietnamese should render with full accents when the current language is `vi`, and English should render when the current language is `en`.

## Goals

- Remove hard-coded English UI copy from `src/pages/office/TeacherAttendance.tsx`.
- Add a dedicated `teacherAttendancePage` namespace to both Vietnamese and English page locale files.
- Keep the component reading copy through `useLanguage().t.teacherAttendancePage`.
- Localize toast success and error messages through the same namespace.
- Keep all attendance logic, API calls, filtering behavior, route access, and layout unchanged.
- Update tests so the default language verifies Vietnamese with accents and a separate test verifies English copy.

## Non-Goals

- Do not redesign the page.
- Do not change teacher attendance API behavior.
- Do not change how sessions are grouped, counted, filtered, or marked.
- Do not add inline `tr(vi, en)` translation pairs in the component.
- Do not reuse loosely related translation keys if their wording does not exactly match this page.

## Translation Design

Add `teacherAttendancePage` to:

- `src/lib/i18n/locales/vi/pages.ts`
- `src/lib/i18n/locales/en/pages.ts`

The namespace covers:

- Page title and subtitle.
- Week navigation aria labels.
- Metric labels: total, pending, present, absent, cancelled.
- Search input label and input hint.
- Filter labels and options: all teachers, all classes, all statuses, pending, present, absent, cancelled.
- Status badge labels.
- Action button labels and active loading labels.
- Empty/loading support text where the page currently displays static UI copy.
- Toast messages for load failure, update failure, marked present, and marked absent.

## Component Design

`TeacherAttendance.tsx` will import `useLanguage`, read `const pageText = t.teacherAttendancePage`, and replace all static text with values from that object.

Use small local helpers for mapping app statuses to localized labels:

- `statusLabel(status, pageText.status)`

The helper should accept translation objects as arguments, not hard-code Vietnamese or English strings.

## Testing

Update `src/pages/office/TeacherAttendance.test.tsx`:

- Set `localStorage.language = 'vi'` in `beforeEach`.
- Verify Vietnamese title, subtitle, status labels, filters, and action buttons.
- Verify marking a session still calls `markTeacherAttendance` with the same payload.
- Verify active loading text is localized for the clicked button only.
- Verify cancelled sessions show localized cancelled status and disabled actions.
- Add an English test by setting `localStorage.language = 'en'` before rendering and checking title, search input hint, filter option, and action/status labels.
- Assert localized toast success for a successful mark action and localized toast error for a failed mark action.

Run focused page tests after implementation, then typecheck and build.

## Risks And Mitigations

- Missing translation keys could render broken text because locale objects are loosely typed. Mitigation: add identical key shapes to both locale files and test both languages.
- Localizing button names could break tests that query by English text. Mitigation: update tests to query the expected localized labels.
- Toast localization is easy to miss because it is not visible in the main DOM. Mitigation: keep `react-hot-toast` mocked and assert localized messages for successful and failed mark actions.

## User-Approved Scope

The approved approach is to use the existing language toggle and translation module, not inline frontend translation pairs. The page should support Vietnamese and English while preserving the existing attendance workflow.
