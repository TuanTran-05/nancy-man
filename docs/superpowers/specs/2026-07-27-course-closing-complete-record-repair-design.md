# Course Closing Complete Record Repair Design

## Objective

Make every existing course-closing record usable as a two-document archive without
inventing academic or tuition facts. After the repair, every record must expose a
stored evaluation DOCX and a stored tuition DOCX. When the historical source is
missing or incomplete, the document must say `Chưa có dữ liệu` in the affected
fields while retaining all verifiable record identity and course information.

The repair covers the 230 production records audited on 27 July 2026:

- 128 records with a ready evaluation document and no requested tuition document;
- 96 records with neither document requested;
- 1 record marked `retrying` whose tuition file already exists in Storage;
- 5 already-complete records.

The solution must remain safe if the production counts change between preview and
apply.

## Data Integrity Rules

1. Never copy evaluation scores, comments, tuition amounts, due dates, exam results,
   or next-course dates from a different course.
2. Never convert an absent numeric value into zero. Zero is a valid score or amount
   and would incorrectly claim that a source value exists.
3. Preserve an existing verified snapshot and a ready stored document unchanged.
4. Preserve any known record-level facts: student identity, class identity, teacher,
   course start date, and course end date.
5. A missing or incomplete historical source is represented explicitly as unavailable
   data, not as a synthetic verified snapshot.
6. A generated placeholder document is a valid archive artifact. Its document status
   may be `ready`, while its data availability remains `unavailable`.
7. Production writes are allowed only from a reviewed deterministic plan whose digest
   matches the current input state.

## Record Schema

Add an optional availability field for each document domain:

```ts
type CourseClosingDataAvailabilityStatus = 'verified' | 'unavailable';

type CourseClosingDataUnavailableReason =
  | 'historical_source_missing'
  | 'historical_source_incomplete';

interface CourseClosingDataAvailability {
  status: CourseClosingDataAvailabilityStatus;
  reason?: CourseClosingDataUnavailableReason;
  assessedAt?: string;
}

interface CourseClosingRecord {
  evaluationDataAvailability?: CourseClosingDataAvailability;
  tuitionDataAvailability?: CourseClosingDataAvailability;
}
```

Compatibility rules:

- A present evaluation or tuition snapshot implies `verified` when the explicit field
  is absent.
- A newly archived live notification writes `verified`.
- A repair-created placeholder writes `unavailable` plus a reason and `assessedAt`.
- The existing `recordVersion` and template version remain `1`; the new fields are
  optional and backward-compatible.

## Placeholder Document Rendering

The existing Word templates remain the only templates. Rendering continues to patch
the original DOCX package so the original logo, fonts, borders, page geometry, and
other embedded assets remain intact.

### Evaluation document

If `evaluationSnapshot` exists, render exactly as today. Otherwise, rendering is
allowed only when `evaluationDataAvailability.status === 'unavailable'`.

The placeholder document fills:

- student and class names from the record;
- teacher name from the record;
- every unavailable date, score, classification, and comment field with
  `Chưa có dữ liệu`;
- the comments area with a concise statement that historical end-of-course
  evaluation data was not recorded.

No unavailable field is rendered as `0` or left with an unresolved template token.

### Tuition document

If `tuitionSnapshot` exists, render exactly as today. Otherwise, rendering is allowed
only when `tuitionDataAvailability.status === 'unavailable'`.

The placeholder document fills:

- the greeting with the student and class names;
- the completed course period from the record's verified start and end dates;
- the exam-result paragraph with `Chưa có dữ liệu kết quả thi cuối khóa`;
- the next-course, amount, and due-date paragraph with
  `Chưa có dữ liệu học phí cho khóa tiếp theo`;
- the notice-date slot with a neutral historical-data notice rather than a fabricated
  notification date.

For the 18 records that contain a sent tuition notification but lack
`paymentDueDate` and a matching ledger, the reason is
`historical_source_incomplete`. Their known notification fields remain in Firestore
but are not promoted into a verified tuition snapshot.

## Repair Planner

A dedicated repair command loads:

- `course_closing_records`;
- `zalo_notifications`;
- `course_fee_ledgers`;
- Firebase Storage metadata for each expected document path.

It produces one deterministic action per document:

- `unchanged_ready`: status is ready and the object exists;
- `repair_ready_status`: the expected object exists but Firestore is not ready;
- `materialize_verified`: a verified snapshot exists but the object is absent;
- `materialize_unavailable_missing`: no usable source exists;
- `materialize_unavailable_incomplete`: source evidence exists but lacks required
  fields;
- `conflict`: status, snapshot, source evidence, or Storage state is internally
  inconsistent and cannot be changed safely.

The plan is sorted by record ID and document type. It includes source fingerprints,
existing document fingerprints, expected Storage paths, counts by action, and a
SHA-256 digest. Any conflict makes the apply phase refuse all writes.

## Apply and Materialization Flow

The command supports:

```text
--report-dir <absolute path>
--apply
--expected-plan-digest <sha256>
```

Without `--apply`, the command is read-only. Apply requires the exact digest emitted
by the latest dry-run.

For each planned action:

1. Re-read the Firestore record and verify its fingerprint still matches the plan.
2. For `repair_ready_status`, verify the Storage object still exists and then update
   document metadata to `ready` without rewriting the object.
3. For a materialization action, write the appropriate availability field and set the
   document to `pending`.
4. Invoke the existing materializer, which renders from the original template and
   saves to the canonical Storage path.
5. Verify the object exists and the resulting Firestore document is `ready`.
6. Record the action result in the apply report.

The command is idempotent. A rerun after partial failure plans only unfinished work.
It never overwrites an existing ready artifact unless a future operator explicitly
adds a separate force-rebuild capability.

## Runtime Behavior

Live evaluation and tuition archive flows continue to require verified source data.
They set the corresponding availability status to `verified` when upserting a
snapshot. Placeholder generation is limited to the repair command and cannot
silently convert a failed live archive into unavailable historical data.

The document download/view endpoint remains storage-only. It does not render or
repair on click.

## Error Handling and Auditability

- A missing required record identity is a conflict.
- A ready Firestore document whose Storage object is absent is not treated as ready;
  it is rematerialized only if a verified snapshot or explicit unavailable marker can
  render it safely.
- A Storage object at the expected path with a non-ready Firestore status is repaired
  by metadata synchronization, not overwritten.
- Rendering or upload failure leaves the document retryable and is reported with the
  record ID, document type, action, and error code.
- Reports do not include service-account data or document contents.
- The final report contains before/after status counts, Storage existence counts,
  action results, failures, and the applied digest.

## Testing

Unit tests must prove:

- verified snapshots retain the existing rendering behavior;
- unavailable evaluation and tuition documents resolve every template slot;
- placeholder documents contain `Chưa có dữ liệu` and do not contain misleading
  numeric zero fallbacks;
- the generated DOCX packages retain the original template media and border/style
  parts;
- the planner classifies all six actions deterministically;
- a changed source fingerprint invalidates apply;
- conflicts block every write;
- an existing Storage object repairs stale Firestore status without upload;
- rerunning after success produces only `unchanged_ready`;
- live archive upserts mark data availability as verified.

The production sequence is:

1. Run focused unit tests and the complete repository test suite.
2. Run the repair command without `--apply`.
3. Review counts, conflicts, and digest.
4. Run apply with the exact digest.
5. Run the read-only audit again.
6. Confirm all production records are `complete`.
7. Confirm both canonical DOCX objects exist for every record.
8. Download and inspect representative verified and unavailable documents from both
   document types.

## Acceptance Criteria

- Every production course-closing record has both document statuses equal to `ready`.
- Both canonical DOCX objects exist in Storage for every record.
- No existing ready artifact was overwritten.
- No cross-course or fabricated academic/tuition value was introduced.
- Missing historical facts are visibly labelled `Chưa có dữ liệu`.
- Existing verified documents retain their original output.
- Placeholder documents retain the logo, fonts, borders, and layout of the original
  templates.
- A second dry-run is idempotent and reports no repair actions or conflicts.
- The repository test suite, typecheck, formatting check, and production build pass.
