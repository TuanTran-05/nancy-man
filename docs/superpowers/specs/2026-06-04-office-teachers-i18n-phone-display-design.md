# Office Teachers I18n And Phone Display Design

## Summary

Update the office `/teachers` page so all static UI copy comes from the existing translation module, with Vietnamese as fully accented copy and English as the alternate language. Also normalize teacher phone numbers for display so numbers starting with Vietnam country code `84` are shown with a leading `0`.

## Goals

- Remove hard-coded page copy from `src/pages/office/Teachers.tsx`.
- Add a dedicated translation namespace for the office teachers page in both Vietnamese and English locale files.
- Keep frontend components reading localized strings through `useLanguage().t`, not through inline `tr(vi, en)` pairs.
- Show Vietnamese text with accents by default when the current language is `vi`.
- Show English text when the current language is `en`.
- Display teacher phone numbers that start with `84` as local numbers that start with `0`.
- Keep phone normalization display-only; do not mutate API data, Firestore data, search data, or teacher identity fields.

## Non-Goals

- Do not change the `/teachers` page layout.
- Do not change schedule aggregation, metrics, attendance status rules, or month navigation behavior.
- Do not add a new language selector.
- Do not rewrite the global translation system.
- Do not normalize phone numbers before storage or API return.

## Translation Design

Add `officeTeachersPage` to `src/lib/i18n/locales/vi/pages.ts` and `src/lib/i18n/locales/en/pages.ts`.

The namespace covers all static copy on the page:

- Page title and subtitle.
- Month navigation labels and current-month button.
- Search label, input hint, and no-match copy.
- Teacher list fallback labels such as missing phone and missing email.
- Metric card labels.
- Class table title and column headers.
- Shift status labels: planned, present, absent, cancelled.
- Makeup badge label.
- Calendar overflow label template.
- Day details title template and empty-day copy.
- Page empty state.
- Error title and reload button.

`Teachers.tsx` will import `useLanguage`, read `const pageText = t.officeTeachersPage`, and pass the needed strings into child presentational components as props. This keeps presentational helpers simple and avoids direct text literals inside them.

## Phone Display Design

Add a small local display helper in `Teachers.tsx`:

- Trim whitespace.
- If the number starts with `84` followed by at least one more digit, display `0` plus the remaining digits.
- Leave numbers that already start with `0` unchanged.
- Leave empty or unusual values unchanged so the existing missing-phone fallback can handle them.

Examples:

- `843857020376` displays as `03857020376`.
- `848486751931` displays as `08486751931`.
- `0384072314` remains `0384072314`.
- Empty phone displays the localized missing-phone label.

This rule is intentionally display-only because the user asked for easier reading when the phone appears on screen.

## Testing

Update `src/pages/office/Teachers.test.tsx`:

- Default Vietnamese render expects accented Vietnamese copy.
- Search input keeps a localized accessible label.
- Error state uses localized Vietnamese copy.
- Day details and status labels use accented Vietnamese.
- English render is verified by setting `localStorage.language = 'en'` before rendering.
- Phone display verifies a teacher phone starting with `84` renders with a leading `0`.

Run the focused page test after implementation. Run typecheck if the translation namespace changes TypeScript expectations.

## Risks And Mitigations

- Missing translation key could fail at runtime because the translation object is loosely typed. Mitigation: keep the same key structure in both locale files and cover both languages in tests.
- Phone formatting could accidentally change search behavior. Mitigation: normalize display only and leave existing raw search data untouched unless the user explicitly asks for display-form search.
- Tests may still look for unaccented strings. Mitigation: update assertions to the new localized copy.

## User-Approved Scope

The approved approach is to use the existing language toggle with Vietnamese and English as separate modes, not to show bilingual text in the same UI. The added phone requirement is included as display-only normalization from leading `84` to leading `0`.
