# Date Time Format Standardization Design

## Goal

Standardize user-facing date and time entry while keeping API and internal storage safe for sorting, querying, and timezone handling.

## Scope

The app will use three user-entry shapes at the manual input layer:

- Time-only: `hh:mm:ss`
- Date-only: `dd/mm/yyyy`
- Datetime: `hh:mm:ss dd/mm/yyyy`

Manual entry is lenient and output is strict. Users may type values such as `9/5/2025`, `5:9`, or `5:9 9/5/2025`; the app normalizes them to `09/05/2025`, `05:09:00`, and `05:09:00 09/05/2025`.

The API and internal code do not adopt those display strings as their canonical format. Canonical formats remain domain-specific:

| Field type | API/internal canonical | User display/export |
| --- | --- | --- |
| Date-only | `YYYY-MM-DD` | `dd/MM/yyyy` |
| Time-only | `HH:mm:ss` | `HH:mm:ss` unless a view intentionally hides seconds |
| Datetime | ISO 8601 datetime | `dd/MM/yyyy HH:mm` or a product-specific display variant |
| Created/audit timestamps | ISO 8601 datetime | formatted display helper |

## Non-Goals

- Do not migrate all existing database data in this change unless a field is already being touched by an endpoint.
- Do not convert date-only concepts such as DOB, attendance date, holidays, or class start/end dates into datetimes.
- Do not standardize third-party dependency locale formats from `node_modules`, generated bundles, or git history.
- Do not change `YYYY-MM` month keys for finance/reporting in this project.

## Architecture

Add a shared date/time normalization module at the app boundary. It owns parsing, validation, zero-padding, canonical conversion, and display formatting.

The frontend uses the module to normalize manual input on blur and to convert values before calling APIs. The backend uses the module to validate canonical API inputs and to normalize import/Zalo edge cases where user-facing strings still arrive. Existing helpers such as `formatVN`, `toVNDateStr`, `getDayFromStr`, and `formatDateForZalo` should delegate to or align with the new module.

Internal date-only logic remains `YYYY-MM-DD` because attendance, class schedule, holiday, report, and range-query behavior currently depends on lexicographically sortable ISO date strings. Datetime values remain ISO 8601 because they represent actual instants.

## Parsing Rules

Date-only:

- Accept `d/m/yyyy` and `dd/mm/yyyy`.
- Normalize to `dd/MM/yyyy`.
- Reject impossible dates such as `31/04/2025`, `29/02/2025`, `00/12/2025`, or `12/00/2025`.
- Convert to canonical `YYYY-MM-DD` only when crossing the API/internal boundary.

Time-only:

- Accept `h:m`, `h:m:s`, `hh:mm`, and `hh:mm:ss`.
- Normalize to `HH:mm:ss`.
- Missing seconds default to `00`.
- Reject invalid times such as `24:00`, `12:60`, or `12:30:60`.

Datetime:

- Accept time then date separated by whitespace: `h:m d/m/yyyy` or `h:m:s d/m/yyyy`.
- Normalize display input to `HH:mm:ss dd/MM/yyyy`.
- Convert to ISO 8601 datetime for API/internal use.
- For manual datetimes without timezone, interpret the local date and time in Vietnam time (`Asia/Ho_Chi_Minh`) before converting to ISO 8601.

## Code Areas

Core utilities:

- `src/lib/core/utils.ts` currently contains `formatVN`, `toDate`, `toVNDateStr`, and `getDayFromStr`.
- `shared/classSchedule.ts` currently validates and computes date-only ranges using `YYYY-MM-DD`.
- `api/lib/zalo/zaloFormat.ts` currently already accepts several Zalo-facing date shapes and returns `dd/MM/yyyy`.
- `api/lib/validation/validations.ts` currently validates several API date-only fields with `YYYY-MM-DD`.
- `api/lib/student/studentImport.ts` currently accepts Excel dates, ISO dates, and slash dates, then stores DOB as `YYYY-MM-DD`.

Primary frontend flows:

- Student DOB/admissions/import
- Class start/end date and holidays
- Attendance date
- Assignment due date
- Receipt/payment and expense dates
- Zalo notification date fields
- PDF/Word/Excel/receipt display

## Refactor Strategy

1. Add the shared parser/formatter with focused unit tests.
2. Wire backend validation helpers to canonical API formats.
3. Add frontend helpers/components for manual text entry with blur normalization.
4. Convert high-risk date-only flows while preserving `YYYY-MM-DD` internally.
5. Convert datetime flows to ISO 8601 at the API boundary.
6. Replace ad hoc display formatting in exports/Zalo/UI with shared display helpers where practical.

## Error Handling

Validation errors should explain the expected user-facing shape:

- Date: `Ngay khong hop le. Dung dinh dang dd/mm/yyyy.`
- Time: `Gio khong hop le. Dung dinh dang hh:mm:ss.`
- Datetime: `Ngay gio khong hop le. Dung dinh dang hh:mm:ss dd/mm/yyyy.`

API errors should describe canonical API expectations:

- Date-only API fields expect `YYYY-MM-DD`.
- Time-only API fields expect `HH:mm:ss`.
- Datetime API fields expect ISO 8601.

## Testing

Unit tests must cover:

- Date padding and valid leap years.
- Invalid day/month combinations.
- Time padding and default seconds.
- Invalid time ranges.
- Datetime parsing in Vietnam time.
- Round trips between `dd/MM/yyyy` and `YYYY-MM-DD`.
- Round trips from user datetime to ISO and back to display.

Integration tests should cover the most important flows:

- Student DOB/import normalization.
- Attendance/class date validation.
- Assignment due date conversion.
- Receipt/payment date display and Zalo payload formatting.
- Export/PDF display format.

## Rollout

Keep the rollout additive first. The parser can accept old `YYYY-MM-DD` where necessary for compatibility, but new manual UI output should display `dd/MM/yyyy`, and API boundaries should remain canonical.

Do not rewrite all historical data in Firestore during this work. Existing records are already aligned with the safer date-only canonical format in many areas.

## Risks

- Converting date-only values to datetimes can create timezone date shifts. The design avoids this.
- Replacing native browser date inputs can reduce picker convenience. The implementation should only replace fields where manual format consistency matters, and can add picker affordances later if needed.
- Some current code compares date strings directly. Those comparisons must continue using `YYYY-MM-DD`.

## Acceptance Criteria

- Users can type `9/5/2025`, `5:9`, and `5:9 9/5/2025` and see normalized values.
- Date-only API/internal flows continue using `YYYY-MM-DD`.
- Datetime API/internal flows use ISO 8601.
- UI, Excel, PDF, receipt, and Zalo-facing display use `dd/MM/yyyy` for dates.
- Invalid dates and times are rejected consistently.
- Tests pass for parser helpers and the major affected flows.
