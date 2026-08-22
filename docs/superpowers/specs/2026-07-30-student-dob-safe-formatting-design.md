# Safe Student Date-of-Birth Formatting

## Problem

The Students directory formats every visible student's `dob` while rendering the table. A
malformed calendar date that still matches `YYYY-MM-DD`, such as `2025-02-30`, is passed to
the strict `apiDateToDisplayDate` parser. The parser throws `Error: Invalid date`, so one bad
student record aborts the entire table render. The student profile overview has the same
unsafe pattern.

## Desired Behavior

- Valid canonical dates continue to display as `dd/MM/yyyy`.
- Invalid stored values display unchanged so staff can identify and correct the data.
- Empty values display as an empty string.
- Rendering a student list or profile never throws because of a malformed `dob`.
- Stored student data is not changed by this fix.

## Design

Add a small pure formatter under `src/lib/student` and use it in both the Students directory
and the student profile overview.

The formatter accepts `string | undefined` and returns a string:

1. Return an empty string for an empty value.
2. For a value shaped as `YYYY-MM-DD`, call the existing strict formatter inside a guarded
   block. Return the formatted value when valid; return the original stored value if strict
   validation rejects it.
3. Preserve the existing fallback for other date strings: format parseable values as
   `dd/MM/yyyy`, and return the original value when parsing fails.

The shared strict date parser remains unchanged. Forms and other callers can continue using
its exceptions for validation.

## Scope

Update:

- `src/pages/common/Students.tsx`
- `src/pages/common/studentProfile/StudentOverviewTab.tsx`
- A new pure formatter and its focused unit test under `src/lib/student`

Do not:

- Repair or migrate Firestore records.
- Change status filtering or student lifecycle behavior.
- Change the global `apiDateToDisplayDate` contract.
- Refactor unrelated date formatting.

## Error Handling

Only malformed date-of-birth display values are converted into a safe textual fallback.
Unexpected failures outside date parsing are not swallowed. Invalid values remain visible,
which preserves the signal that staff need to correct the record.

## Testing

Use test-driven development. The focused unit test must first reproduce the current throw,
then verify:

- A valid canonical date is displayed as `dd/MM/yyyy`.
- Impossible dates such as `2025-02-30` are returned unchanged.
- Out-of-range dates such as `0000-00-00` are returned unchanged.
- A supported non-canonical parseable date keeps the existing formatted behavior.
- An invalid non-canonical value is returned unchanged.
- An empty value returns an empty string.

After the focused test passes, run the related tests, TypeScript typecheck, and the production
build.
