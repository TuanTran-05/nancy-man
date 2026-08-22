# Canonical Student Profile and Database Normalization Design

**Date:** 2026-08-06

**Status:** Approved design; amended 2026-08-06 after codebase verification of the plan set

**Scope:** Student identity, course progression, authentication linkage, academic history, finance linkage, canonical reads, migration, cutover, rollback, and legacy retirement

## Executive decision

EduTrack will adopt one stable `students/{profileId}` document per human student. Course, class, term, attendance, evaluation, assignment, tuition, payment, notification, and authentication linkage records remain separate data related to that stable profile ID.

The conversion will use a phased strangler rollout:

0. run a read-only production discovery pass that produces the real reference inventory and legacy-state census;
1. establish canonical identity invariants and stop new duplicate profiles;
2. rewrite promotion and class-closing writes to preserve profile IDs;
3. move every read surface to canonical IDs and canonical enrollments, alias-safety-critical ones first;
4. build a fail-closed, manifest-driven merge engine;
5. rehearse against a production-derived snapshot;
6. perform a reviewed production dry-run;
7. cut over outside operating hours with a 30–60 minute write-maintenance window;
8. monitor, remove legacy fallbacks, and retire duplicate profile documents.

No production duplicate merge may run before the code paths that create new duplicates have been removed and deployed.

Phase 0 is mandatory and comes first because it is read-only, depends on no other workstream, and converts the program's largest unknown — which collections actually hold student references, and what state the existing soft-merged profiles are in — into data. The reference registry, the baseline, and the candidate census are all derived from its output rather than from assumption.

## Current production baseline

The baseline below was observed during the 2026-08-06 investigation. It is diagnostic context, not an apply-time contract. Every production operation must regenerate its own baseline.

- `students` contains 676 physical documents.
- The safe enrollment migration on 2026-08-01 created 334 canonical enrollments.
- The 2026-08-05 enrollment audit found 559 current students with existing canonical enrollments, zero new safe-backfill candidates, and zero planner invariant violations.
- Fifty-eight historical duplicate documents have already been soft-merged **by the legacy script, using a different schema than this design defines**. See "Legacy soft-merge state" below; these are not aliases and must be normalized, not assumed correct.
- Student code `HS260167` still has two physical profiles. Automatic merge is blocked because both profiles have credentials and the student-password material differs.
- Five additional current identity groups are probable duplicates based on normalized name, date of birth, and contact but use different student codes. They require manual review.
- Accounting summary health is complete for the physical-document model, but it produces one summary per physical profile document, so completeness does not prove correct student identity boundaries.

### Legacy write defect

The recurrence defect is in `server/api/classes/helpers/studentImportHelper.ts`. Importing a cohort into a target class reads the source roster from `students.classId` (line 32), creates a new `students` document with `db.collection('students').doc()` (line 151), copies selected profile and credential fields, marks the source profile `enrollmentStatus: 'promoted'` (lines 125 and 172), and repoints linked users (line 185). This conflicts with the canonical enrollment model already used by transfer, accounting summaries, and ledger generation.

The cloned document is also written without the denormalized `admissionSearchName`, `admissionSearchDob`, and `admissionSearchContact` fields, which has a direct consequence for the creation guard described under "Denormalized identity field prerequisite".

### Legacy soft-merge state

`scripts/merge-duplicate-student-records.ts` performed the existing soft merges with a materially different contract than this design:

- it marks the retired document with `mergedIntoStudentId` and `studentLifecycle: 'archived'` (line 505) and never writes a `student_profile_aliases` record, so production currently contains **zero alias documents**;
- it moves only fourteen collections (`FIELD_REFERENCE_COLLECTIONS`, `KEYED_REFERENCE_COLLECTIONS`, `DERIVED_REFERENCE_COLLECTIONS` at lines 39–64) plus `users` and `student_auth_credentials`, out of the sixty-six collections the server currently uses, so references in the unmoved collections may already be dangling;
- `mergedIntoStudentId` has no runtime consumer anywhere in the application; only the merge script reads it.

Two consequences bind the rest of this design. First, a retired document under the legacy scheme carries no `studentProfileState`, so a naive canonical predicate classifies all fifty-eight of them as canonical profiles. Second, the merge planner cannot audit "existing aliases" because none exist; it must reconstruct the legacy-to-canonical mapping from `mergedIntoStudentId` before it can verify anything.

## Goals

1. Guarantee one canonical profile per human student.
2. Guarantee that promotion, transfer, reenrollment, and course reset never create a new profile for an existing student.
3. Make `student_course_enrollments` the authority for class/course/term membership and history.
4. Make the student document ID the stable foreign key for every mutable academic, finance, notification, and authentication relationship.
5. Preserve old URLs, references, and audit evidence through server-only aliases.
6. Enforce global student-code uniqueness transactionally.
7. Normalize all existing duplicate records without losing academic history, financial evidence, wallet value, credentials, sibling relationships, or auditability.
8. Provide deterministic dry-run artifacts, explicit human approvals, drift detection, durable journals, verification, and bounded rollback.
9. Remove presentation-time identity heuristics as an authoritative source after production normalization.

## Non-goals

- Reconstruct unsupported historical enrollment periods from class-level terms alone.
- Automatically merge different-code identity candidates.
- Automatically choose between conflicting identity fields, two funded wallets, colliding ledgers, or ambiguous credentials.
- Change tuition amounts, receipt amounts, payment states, attendance values, evaluation content, or submission content while changing student ownership.
- Reissue retired student codes to another human.
- Make raw student, credential, enrollment, or alias collections directly readable by clients.
- Perform unrelated UI redesign or broad refactoring.

## Terminology

- **Canonical profile:** The single active `students/{profileId}` document for a human student.
- **Legacy profile:** A duplicate physical student document that must be merged into a canonical profile.
- **Business student code:** The visible code such as `HS260167`; this is not the Firestore profile document ID.
- **Canonical ID:** The Firestore document ID of the canonical profile.
- **Alias:** A server-only mapping from a retired legacy profile ID or secondary business code to a canonical profile.
- **Open enrollment:** An enrollment whose status is `trial`, `active`, or `on_leave` according to the shared enrollment domain rules.
- **Projection:** A denormalized current-state field or summary that can be rebuilt from canonical sources and is never the authority.

## Alternatives considered

### Presentation-only deduplication

Continue using `getCurrentStudentRecords` and similar heuristics to hide duplicates in lists.

Rejected because authentication, academic history, wallet, ledgers, receipts, profiles, and database counts remain divided even when a screen displays one row.

### Immediate big-bang merge

Extend the current merge script and apply it directly to production.

Rejected because the current reference registry omits known student-linked records such as invoices, payment requests, and assignment-attempt drafts; it does not inventory unknown collections; and it cannot safely resolve the current credential conflict.

### Phased canonicalization with controlled cutover

Deploy canonical write/read behavior first, build and rehearse a complete migration engine, then perform a short maintenance-window cutover.

Selected because it stops recurrence before cleanup, permits independent review gates, and makes production data movement deterministic and auditable.

## Global data invariants

The following invariants apply to every workstream and production state after final cutover:

1. Each human student has exactly one canonical profile.
2. Each normalized business student code maps to exactly one canonical profile.
3. A retired or secondary code is never mapped to a different human later.
4. A canonical profile has at most one open enrollment.
5. Promotion and transfer preserve the canonical profile ID.
6. `student_course_enrollments` is the authority for course membership, current class, term dates, join dates, leave state, completion, and transfer.
7. `students.classId`, `teacherId`, and `enrollmentStatus` are compatibility projections only while legacy consumers remain. They must match the current enrollment and are removed after the fallback-retirement gate.
8. `promoted` is not a profile lifecycle or final canonical profile status. A student awaiting placement is an enrolled profile with no open enrollment after a completed course.
9. Every mutable student-linked record points to a canonical ID after normalization.
10. Immutable audit records may retain legacy IDs only when an alias resolves them to the canonical profile.
11. Every student or parent login resolves to the canonical profile before authorization and credential verification.
12. A canonical profile has exactly one selected credential set per login type.
13. Financial ownership may change from a legacy ID to a canonical ID, but monetary fields and posted transaction facts must not change.
14. Accounting summaries, class counts, dashboard counts, and wallet rows are derived from canonical profiles and enrollments, never physical legacy documents.
15. Unknown student references cause audit/apply failure; they are never silently skipped.
16. A `students` document carrying a non-empty legacy `mergedIntoStudentId` is never canonical, never resolvable as a login identity, and never counted as a student, regardless of whether it has been converted to a `merged_tombstone` yet.
17. Every identity query that decides whether a human already exists must be able to see profiles that lack denormalized search fields. A Firestore equality query alone does not satisfy this invariant, because it silently omits documents missing the field, and treats a stale field as a non-match.

## Target data model

### `students/{profileId}`

The canonical student document contains human identity and center-level profile state:

- primary business `studentId` code;
- normalized search fields;
- name, date of birth, gender, contact, address, and guardian/profile fields;
- face image reference;
- sibling group reference;
- center-level lifecycle such as lead, trial, enrolled, or archived;
- original enrollment/admission metadata;
- optional `currentEnrollmentId` projection;
- migration metadata such as `legacyProfileIds` after a merge.

Class, teacher, course, term, join/leave windows, and tuition are not profile identity. Legacy current-class fields remain only during compatibility rollout and are deleted after canonical-read verification.

### `student_course_enrollments/{profileId}_{classId}_{termStart}`

This collection remains the canonical relationship for class/course history. Its identity and validation continue to use `makeStudentCourseEnrollmentId` and `assertValidStudentCourseEnrollment`.

Supported enrollment status includes `trial`, `active`, `on_leave`, `completed`, `transferred`, and `dropped`. The repository must continue enforcing at most one open enrollment per profile.

### `student_code_registry/{normalizedCode}`

Firestore has no unique constraint, so a server-only registry enforces code ownership transactionally.

Each document contains:

- `normalizedCode`;
- `canonicalProfileId`;
- `isPrimary`;
- `status`: `active`, `alias`, or `retired`;
- `createdAt`, `updatedAt`, and actor/audit metadata.

Creating or changing a student code must read and claim the registry document in the same transaction as the profile write. A retired code remains reserved. Merging different-code profiles may leave several registry documents pointing to one canonical profile, with exactly one primary code.

### `student_profile_aliases/{legacyProfileId}`

Aliases preserve old profile URLs and historical references during and after retirement. Each document contains:

- `legacyProfileId`;
- `canonicalProfileId`;
- `mergeRunId`;
- `createdAt`;
- a non-sensitive reason code.

Aliases are server-only, immutable except for an audited forward repair, and must form an acyclic one-hop mapping. The merge planner flattens any preexisting alias chain before apply.

### Migration control collections

The migration uses server-only collections:

- `student_profile_merge_runs/{runId}` for reviewed manifest identity, target project/database, commit SHA, status, counts, and timestamps;
- `student_profile_merge_journal/{runId_operationId}` for operation identity, before/after fingerprints, apply status, and verification state;
- `_maintenance/student_identity` for `normal` or `read_only` mode, active run ID, timestamps, and the authorized migration actor.

Credential secrets, password hashes, salts, access tokens, and full private profile payloads must not be written to manifests or journal documents.

## Canonical ID resolution

Add a server-side `resolveCanonicalStudentId(db, inputId)` boundary used before student-scoped authorization and data access.

Resolution order:

1. resolve `student_profile_aliases/{inputId}` first, because an alias may coexist with its still-present physical source document during and after apply;
2. return the input when it names an existing profile that is neither a `merged_tombstone` nor a legacy soft-merge record;
3. when the input names a legacy soft-merge record (non-empty `mergedIntoStudentId`) that has no alias yet, follow that pointer exactly one hop and mark the resolution `legacy_soft_merge_pointer`;
4. when the input is a business code, resolve `student_code_registry/{normalizedCode}`;
5. reject missing, cyclic, multi-hop, or inconsistent mappings;
6. return both requested and canonical IDs for audit logging.

Step 3 exists only to keep the fifty-eight pre-existing soft merges safe between deployment of the resolver and completion of the legacy soft-merge normalization described below. It is a compatibility branch with a scheduled removal: once every legacy record has a real alias and a `merged_tombstone` marker, resolution through `mergedIntoStudentId` must fail closed rather than resolve, and the branch is deleted with the other legacy fallbacks.

All profile, auth, parent, accounting, wallet, attendance, assignment, notification, and report entry points must use this boundary. Client-visible responses expose the canonical ID and may include a redirect indication, but never expose credential or alias internals.

## Promotion and course progression

Replace clone-based class import with a canonical progression service. A cohort operation orchestrates one idempotent transaction per student rather than one oversized batch.

For each student, the transaction performs all reads before writes:

1. read the canonical profile;
2. read source and target classes/terms;
3. read every enrollment for the profile;
4. read linked student and parent user projections;
5. read source/target ledgers and pending payment requests required by the existing transfer policy;
6. validate source membership, target term, target class state, and idempotency event;
7. close the source open enrollment as `completed` for course completion or `transferred` for an in-course transfer;
8. open the target enrollment with the same profile ID through `upsertSystemEnrollment`;
9. update temporary profile projections and linked-user projections without changing their canonical `studentId`;
10. update class counters;
11. create or update the deterministic target ledger using existing ledger identity rules, and void incompatible pending source payments according to current transfer behavior;
12. write a progression event and commit atomically.

The idempotency key is:

```text
promotion:{sourceClassId}:{targetClassId}:{profileId}:{targetTermStart}
```

Retrying the same operation returns the existing result and creates no new profile, enrollment, ledger, or progression event.

Archiving a class no longer patches profiles to `promoted`. Final course closing closes eligible open enrollments. A direct archive request is rejected while the class still has an open enrollment unless it runs through the explicit course-closing transition. An enrolled profile with a completed last enrollment and no new open enrollment is displayed as waiting for placement.

## Canonical read model

### Student directory and headcount

The authorized server read channel returns canonical profile rows enriched with their open enrollment. Headcount equals the number of canonical profiles with an eligible open enrollment, with explicit trial/on-leave buckets.

Identity heuristics remain temporarily as anomaly detection but stop deciding the authoritative roster after migration verification.

### Class roster

Class detail, attendance roster, evaluation roster, assignment targeting, course closing, class counters, and ledger generation query canonical enrollments by `classId`. They do not query `students.classId` as authority.

### Student 360 profile

The profile route resolves aliases, loads one canonical profile, and loads all academic and finance relationships by canonical ID. Requests to a legacy profile ID redirect or return the canonical profile without creating a second UI identity.

### Authentication and linked users

Authentication resolves business code or legacy profile ID to the canonical profile first. It no longer selects an `active` document from several same-code documents. Linked user projections retain the canonical profile ID throughout progression.

### Wallet and accounting

Wallet balances return one row per canonical profile. Current class comes from the open enrollment or canonical accounting summary. Historical course balances remain separate ledgers related to the same profile.

Accounting summary creation/rebuild skips aliases and tombstones and produces exactly one summary for each eligible canonical profile.

## Student reference registry

The migration engine contains an explicit typed registry. Each entry defines collection path, reference kind, read strategy, rewrite strategy, collision rule, verification rule, and rollback capability.

Reference kinds include:

- direct `studentId` fields;
- document IDs that encode student ID;
- deterministic user/credential document IDs;
- arrays or nested payloads containing student IDs;
- derived documents to delete and rebuild;
- immutable audit references to preserve and resolve through aliases;
- pending outbox/job payloads that must be rewritten or drained.

### The registry is derived, not assumed

The registry contents are an output of the Phase 0 discovery inventory, not a list written from memory. The server currently references sixty-six distinct collections; any registry drafted before the inventory runs will be both incomplete and speculative, and the cost of discovering a gap late is high, because an unregistered match found during the production audit forces a registry, comparator, verifier, and rollback change plus a new release.

The drafting rule is therefore:

1. run the recursive inventory read-only against production for the full candidate ID set;
2. classify every collection that produced a match, and every collection whose schema can hold a student reference even if it produced no match in the current data;
3. write one typed registry entry per distinct document shape found;
4. record the collections deliberately classified as student-free, with the evidence, so a later reviewer can see the classification was made rather than forgotten.

The following areas are known to require coverage and are a floor, not a ceiling:

- academic: attendance, evaluations, submissions, admissions history, course-closing records, student-course enrollments, and assignment-attempt drafts;
- finance: course-fee ledgers, wallet transactions, receipts, invoices, payment requests, payment-order codes, expenses, finance idempotency and payment-lock records, accounting summaries, and pending accounting/notification outbox entries;
- authentication: all user documents linked by `studentId`, deterministic student/parent user documents, student credential documents, and the password-reset record families;
- messaging: notifications, Zalo notification logs, Zalo bulk-job items and jobs, admin notifications, realtime events, and nested pending payloads;
- jobs: outbox jobs and any other job family whose payload names a student, registered by exact job type and lifecycle state rather than by collection;
- profile-owned fields: wallet snapshot fields, sibling group, face-image reference, course joins, leave periods, lifecycle flags, and admission metadata.

No entry may be written for a collection that the inventory shows does not exist. Where the floor list above names a collection that discovery does not find, the discrepancy is resolved in the report before the registry is frozen.

The auditor recursively lists top-level collections and subcollections and scans for the candidate legacy IDs. A match outside the typed registry is an `UNKNOWN_REFERENCE` blocker. Processed historical audit logs may retain legacy IDs when the alias is verified; pending jobs may not.

## Duplicate candidate detection

Candidate classes are separate and have different automation policies.

### Exact-code duplicates

Documents sharing the same normalized business student code are candidates for deterministic planning. They are not automatically mergeable when any blocker exists.

### Different-code identity candidates

Normalized name, date of birth, and contact generate anomaly candidates. Because siblings, twins, shared contacts, and data-entry mistakes can collide, every different-code group requires explicit human confirmation and a primary-code decision.

### Legacy soft-merge records

A `students` document with a non-empty `mergedIntoStudentId` is its own candidate class. It is not an alias, not a tombstone, and not a fresh duplicate. Every such record is audited for pointer validity, lingering references across the full inventory, credentials, balances, and summaries, and then normalized as described below.

### Existing aliases/tombstones

Documents that already carry a valid alias and `merged_tombstone` marker are audited for alias correctness, lingering references, credentials, balances, and summaries. They are not treated as fresh candidates unless the current alias is invalid. Until the legacy soft-merge normalization completes, this class is expected to be empty in production.

## Legacy soft-merge normalization

The fifty-eight existing soft merges must be brought onto the canonical schema before, or as the first stage of, the main normalization run. This is a distinct workload from merging a fresh duplicate group, because the identity decision has already been made and only the representation and the reference closure are wrong.

For each legacy record the planner:

1. validates that `mergedIntoStudentId` resolves to exactly one live, non-merged profile, and blocks on a missing, self-referential, chained, or ambiguous pointer;
2. claims the retired document's business codes for the canonical profile in the code registry;
3. creates the immutable one-hop `student_profile_aliases/{legacyProfileId}` record that the legacy script never wrote;
4. re-runs the full recursive reference inventory for the legacy ID and plans a rewrite for every reference the fourteen-collection legacy script could not have moved;
5. reconciles any residual credential, wallet, ledger, or summary ownership under the same blocker rules as a fresh merge;
6. converts `mergedIntoStudentId` plus `studentLifecycle: 'archived'` into the canonical `merged_tombstone` metadata.

A legacy record whose reference closure is already clean still requires steps 2, 3, and 6; the alias and the code claim are what make the old links resolvable and the code reservation durable. The run reports legacy soft-merge groups separately from fresh merge groups so that reviewers can see which part of the plan is representation repair and which part moves live data.

Verification treats a remaining `mergedIntoStudentId` without a corresponding alias and tombstone as a blocker, not as evidence of a completed merge.

## Denormalized identity field prerequisite

The exact-human creation guard queries `students` by `admissionSearchName`, `admissionSearchDob`, and `admissionSearchContact`. Those fields are written only by the admissions and canonical creation paths (`server/api/lib/admissions/matching.ts` lines 41–43); the bulk import handler and the clone path in `studentImportHelper.ts` do not write them, and `matching.ts` lines 54–60 already compensate by recomputing from `name` at read time.

A Firestore equality query omits documents that lack the queried field. Without remediation the guard would therefore be blind to exactly the population it exists to protect: the cloned duplicates and imported profiles.

Two things are required before the guard can be trusted:

1. an additive, idempotent backfill that computes and writes the three normalized fields for every existing `students` document, using the same normalizers as `matching.ts`, run and verified before the guard becomes authoritative;
2. a standing coverage check reported by the identity health audit and treated as a required-mode blocker while non-zero.

The backfill is additive and touches no identity, relationship, or monetary value, so it may run under normal operations and does not require the maintenance window.

### Coverage has three states, not two

Implementation established that "missing" is not one condition, and that a check demanding an absolute zero would never go green.

- **Absent.** The field was never written. Additive backfill fixes it.
- **Stale.** The field exists but no longer matches its source, because `name`, `dob`, or `contact` changed after the field was denormalized. A stale value blinds the equality query exactly as an absent one does, so it counts against coverage. Repairing it overwrites existing data rather than adding to it, so it is a separate opt-in from the additive default.
- **Underivable.** These three fields are derived from `name`, `dob`, and `contact`. A profile missing one of those sources cannot be backfilled at all, and normalizing an empty source yields an empty field that is indistinguishable from an absent one.

The coverage blocker therefore counts absent and stale profiles, both of which are fixable. Underivable profiles are counted and named separately as a residual exclusion in the frozen baseline, in the same way as the pre-existing finance anomalies.

The blocker counts canonical profiles only. A retired document is never a valid creation-conflict target and its canonical twin already carries complete fields, so counting retired documents would hold the blocker non-zero until retirement deletes them — which happens long after the gate they would be blocking.

Treating underivable profiles as a coverage gap would make the gate permanently unreachable and block the entire program on data that no backfill can produce. Excluding them silently would be worse: these profiles are precisely the ones the guard can never match on all three fields, so they remain a real duplicate risk. The baseline records them so the risk is visible and bounded rather than hidden or fatal.

## Canonical profile selection

After human identity equivalence is established, the planner selects a canonical document with deterministic scoring:

1. non-merged and non-revoked profile;
2. current open enrollment;
3. current linked user/auth context;
4. active financial relationship or canonical accounting summary;
5. current-class projection consistency;
6. profile completeness and verified timestamps;
7. lexicographic document ID as the final tiebreak.

For legacy promotion duplicates, this normally keeps the currently active profile, minimizing disruption to current authentication, enrollment, and finance. The manifest records every score and reason. A reviewer may override the selected canonical ID only by regenerating a new signed-off manifest; apply never accepts an edited result with a stale digest.

## Field reconciliation

The planner emits a field-level decision for every canonical profile field.

- `createdAt` takes the earliest credible creation time.
- Primary student code follows the approved code decision; all retained secondary codes become registry aliases.
- Exact non-empty identity values are retained.
- Conflicting name, date of birth, gender, contact, guardian, or admission fields block automatic merge.
- Current canonical face image is retained; alternate image paths are fingerprinted for review and are not deleted during cutover.
- Conflicting sibling groups block automatic merge.
- `legacyProfileIds` is the sorted union of merged IDs.
- Legacy `courseJoins` and leave windows are preserved as corroborating metadata during compatibility, but canonical enrollments remain authoritative.
- Migration timestamps never overwrite historical business timestamps.

The apply executor cannot invent a field choice that is absent from the reviewed manifest.

### Mixed timestamp representations

Production stores the same logical instant in three different physical forms. The clone path writes `createdAt` as a Firestore `Timestamp` through `FieldValue.serverTimestamp()`, other paths write ISO strings, and a known set of user documents stores `updatedAt` as a `Timestamp` where the declared type promises a string.

Every comparison and every fingerprint must therefore normalize before it acts:

- canonical serialization converts `Timestamp`, ISO string, and epoch number to one deterministic encoding, and a value that cannot be interpreted as an instant is a blocker rather than a silently unequal value;
- "earliest credible creation time" compares normalized instants, never raw field values;
- document fingerprints are computed over the normalized projection, so the same document produces the same fingerprint in the preliminary audit and in the final audit.

This is a correctness requirement for drift detection, not a cosmetic one. An unnormalized timestamp makes a document appear to have changed between the two audits, which aborts the run inside the maintenance window for no real reason.

## Financial normalization

Financial records require stronger invariants than general references.

1. The planner calculates pre-merge totals per profile and canonical group for wallet balances, posted receipts, invoice amounts, ledger amounts, discounts, paid totals, refunds, and pending payments.
2. Moving ownership may update `studentId`, deterministic document ID, ledger ID, or nested allocation references, but does not change monetary facts.
3. Recreated keyed documents retain `legacyStudentId`, `legacyDocumentId`, and migration audit metadata where the schema permits.
4. When a ledger ID changes, every dependent receipt allocation, invoice, payment request, order-code record, and pending job must be rewritten in the same reviewed plan.
5. A target-key collision blocks apply unless the two documents are proven semantically identical by a collection-specific comparator.
6. Two non-zero wallet snapshots, inconsistent wallet history, two active pending payments for the same obligation, or conflicting ledgers require manual reconciliation.
7. Derived accounting summaries for legacy profiles are deleted only after source references verify; canonical summaries are then rebuilt.
8. Pre/post group and global monetary totals must match exactly before maintenance mode is lifted.

No float comparison is used for money; existing integer-money normalization remains mandatory.

### Pre-existing finance anomalies are baselined, not discovered at cutover

Production is known to contain course-fee ledgers with no corresponding enrollment row. These are not caused by duplicate profiles and are not repaired by this program, but they will make enrollment-derived and ledger-derived totals disagree.

Phase 0 classifies every such anomaly and records it as a named, counted, known exclusion in the frozen baseline. Verification then compares against that baseline rather than against an idealized zero. An anomaly that appears during the run and is not in the baseline is a real blocker; an anomaly that was already in the baseline is neither a blocker nor a reason to widen the merge's scope.

Without this step the global money and roster invariants would fail inside the maintenance window for a pre-existing reason, and the operator would face an abort decision with no way to tell the two cases apart.

## Credential and linked-user normalization

Credential conflicts are never resolved by comparing or exporting secrets.

- Manifests store only existence, version, update timestamp, and non-reversible fingerprint metadata.
- When one credential exists, it is moved or selected for the canonical ID.
- When both exist and the current linked login demonstrably uses one canonical credential, the reviewer may select that credential.
- When usage cannot be proven or credential material differs ambiguously, the group requires a forced password reset and explicit approval.
- Old credentials remain inaccessible but retained through the rollback window; they are deleted only during legacy retirement.
- All linked user documents are inventoried by field query as well as deterministic ID, because existing data may have already repointed the field without renaming the document.
- Duplicate role accounts, conflicting parent/student accounts, or unknown linked roles block automatic apply.

## Migration artifacts and drift protection

Dry-run is production-read-only and produces an immutable local report set containing:

- migration version and actor;
- target project and database IDs;
- source commit SHA;
- generation timestamp and production snapshot/export identity;
- candidate groups and canonical-selection evidence;
- field decisions;
- every reference operation;
- collection-specific collision decisions;
- pre/post expected counts and monetary totals;
- before/after fingerprints;
- exclusions and blockers;
- canonical JSON digest;
- `approved: false` by default.

Apply requires an explicitly reviewed artifact whose target, commit, snapshot, version, and digest match. Apply preflight creates the server-side run record only after target/digest validation and before any business-data write. It then re-reads all candidate profiles and referenced documents. Any source drift, new reference, new payment, changed credential metadata, new enrollment, changed alias, or checksum mismatch aborts the run before the first business-data write; the control record is marked aborted with no applied operations.

Every successful operation receives a durable server-side journal entry. Local journal synchronization is secondary; a local write failure cannot erase the durable record.

## Maintenance window and mutation guard

Production cutover is scheduled outside operating hours. Student/class/attendance/evaluation/assignment/notification/finance/auth mutations enter read-only mode for no more than 60 minutes, with a 30-minute target.

`_maintenance/student_identity` is checked by the shared server mutation guard. During `read_only` mode:

- normal application mutations fail with a clear maintenance response;
- reads remain available through canonical/alias-aware paths;
- only the exact migration actor bound to the active run ID may write migration operations;
- a missing/unreadable maintenance state fails closed for affected mutations when the last known state is `read_only`;
- maintenance cannot be lifted while verification or monetary invariants are incomplete.

The mutation inventory must cover student creation/import/update/status/delete/transfer, class import/promotion/archive/reset, admissions decisions, attendance, evaluation, assignment/submission, credentials, wallet, receipts, invoices, payments, ledgers, notifications, and jobs that can create student-linked data.

## Apply order

For each approved group, the executor follows a dependency-aware order while maintenance remains active:

1. create/verify the merge-run record and operation journals;
2. claim all business codes for the canonical profile;
3. create the legacy profile alias;
4. reconcile non-secret canonical profile fields;
5. recreate/move keyed academic and enrollment documents;
6. recreate/move ledger keys and dependent finance references;
7. rewrite direct, nested, user, notification, and pending-job references;
8. select canonical credentials and verify the canonical authentication path;
9. rewrite linked-user ownership and disable legacy authentication paths;
10. rebuild canonical derived summaries and remove legacy derived summaries;
11. mark the legacy profile as a rollback-window tombstone with zero active wallet ownership and canonical alias metadata;
12. verify the group before proceeding;
13. update group/run status.

Operations exceeding Firestore transaction limits are split into deterministic stages. A stage cannot be considered complete until its durable journal and verification succeed. Alias-aware reads make an applied canonical mapping stable while later stages finish, but normal writes remain blocked until the entire run passes.

## Backup and rollback

A Firestore managed export is mandatory immediately before the final manifest is generated. The run record stores the export identity.

Rollback policy has a hard boundary:

- **Before maintenance is lifted:** automated rollback may restore exact before-images or reverse ownership only when every affected document still matches the journaled after-fingerprint. Any drift blocks rollback and requires manual investigation.
- **After maintenance is lifted:** automated data rollback is prohibited because new legitimate writes may depend on canonical IDs. Recovery becomes forward repair using aliases, journals, and the managed export.

Legacy profile and credential documents remain as inaccessible tombstones for at least 30 calendar days and at least seven consecutive successful daily audits. They may then be removed from their active collections only when all references are canonical, no rollback investigation is open, and aliases remain valid.

Code rollout remains independently reversible through canonical-read feature controls until legacy fallback retirement. Reverting code must never re-enable clone-based promotion.

## Verification

### Automated tests

Tests cover:

- global code registry claim, conflict, retry, alias, and retired-code behavior;
- canonical ID and code resolution, missing aliases, cycles, authorization boundaries, and the legacy `mergedIntoStudentId` compatibility branch including its fail-closed removal;
- exact-human creation conflict detection against profiles that lack denormalized admission-search fields;
- canonical serialization of `Timestamp`, ISO-string, and epoch-number instants producing one stable fingerprint;
- realtime recipient resolution from canonical enrollments rather than the linked-user class projection;
- promotion ID stability, source closure, target opening, ledger behavior, linked users, counters, and retry idempotency;
- class archive/course close without profile promotion;
- one-open-enrollment invariant under concurrent operations;
- wallet, directory, profile, class roster, parent/student, accounting, and auth canonical reads;
- candidate detection and deterministic canonical selection;
- every registered reference kind and collection-specific collision policy;
- different-code manual-review enforcement;
- field, sibling, wallet, ledger, pending-payment, and credential blockers;
- manifest ordering, target binding, digest, source drift, and unknown-reference aborts;
- durable journal behavior and failure injection;
- pre-maintenance rollback, rollback refusal after drift, and post-maintenance forward-repair policy;
- Firestore rules and indexes for all new server-only collections;
- production build, typecheck, focused suites, broader relevant suites, and emulator integration.

### Snapshot rehearsal

The full planner/apply/verify/rollback cycle runs against a staging or emulator database restored from a production-derived export. It includes the `HS260167` conflict, all current different-code candidates, legacy soft-merged records in every observed shape, profiles missing denormalized search fields, mixed timestamp representations, and high-reference-count synthetic cases.

### Production dry-run review

Reviewers compare:

- candidate and blocker counts;
- collection/reference counts;
- canonical-selection reasons;
- code registry operations;
- enrollment/open-enrollment totals;
- wallet/ledger/receipt/invoice/payment totals;
- credential conflict classifications;
- unknown-reference count;
- expected physical/canonical profile and summary counts;
- manifest digest, snapshot identity, target, and commit.

Any unexplained difference from the latest baseline stops approval.

### Post-apply global invariants

Maintenance may be lifted only when:

- duplicate canonical business codes equal zero;
- unresolved exact-code groups equal zero except explicit manual holds excluded from apply;
- references to merged profile IDs equal zero outside approved immutable audit evidence;
- unknown reference matches equal zero;
- profiles with more than one open enrollment equal zero;
- linked users or active credentials on aliases equal zero;
- summaries for aliases/tombstones equal zero;
- canonical summary count matches eligible canonical profile count;
- class roster counts match canonical enrollment counts;
- promotion-created profile count equals zero;
- wallet returns at most one row per canonical profile;
- group and global monetary totals match the reviewed pre-apply totals;
- pending migration operations and failed journal entries equal zero;
- `students` documents carrying a legacy `mergedIntoStudentId` without a matching alias and tombstone equal zero;
- `students` documents whose denormalized admission-search fields are absent or stale equal zero, with underivable profiles counted separately against the frozen baseline;
- finance anomalies observed outside the frozen Phase 0 baseline equal zero;
- auth, profile, class, attendance, wallet, receipt, invoice, payment, reporting, and realtime-recipient smoke tests pass.

## Security and access control

- `students`, credentials, enrollments, aliases, registries, merge runs, journals, and maintenance control remain server-only under Firestore rules.
- Authorized API projections continue allowlisting fields by role.
- Migration artifacts exclude credential secrets and unnecessary personally identifiable values.
- Only admin migration credentials for the exact target project/database may run dry-run/apply/rollback.
- Apply requires explicit command flags and reviewed artifact paths; dry-run remains the default.
- Audit entries record actor, run ID, legacy ID, canonical ID, operation kind, and non-sensitive fingerprints.

## Observability and legacy retirement

Add a canonical identity health record and scheduled/read-only audit with:

- physical, canonical, alias, and tombstone counts;
- duplicate and candidate counts;
- unknown/noncanonical reference counts;
- open-enrollment conflicts;
- registry/profile mismatches;
- linked-user and credential mismatches;
- wallet/summary/class-count inconsistencies;
- pending/failed migration and projection jobs;
- legacy soft-merge records without alias and tombstone;
- student documents missing denormalized admission-search fields;
- most recent green audit timestamp.

After 30 days and seven consecutive green daily audits:

1. delete inaccessible legacy profile/credential tombstones while retaining aliases and audit evidence;
2. remove legacy `students.classId`, `teacherId`, and `enrollmentStatus` authority/fallbacks;
3. remove presentation deduplication as an authoritative roster mechanism, retaining it only as anomaly detection if useful;
4. remove the wallet behavior/test that intentionally displays promoted legacy profiles;
5. remove the `mergedIntoStudentId` compatibility branch from canonical resolution;
6. add a CI/static architecture check that rejects new clone-based student creation or authoritative class-projection roster queries.

### The linked-user class projection has a live consumer

Removing `classId` from linked user documents is not a pure cleanup. `server/api/lib/realtime/deltaRecipients.ts` selects realtime recipients with `users.where('classId', '==', classId)` in both `classMemberUserRecipients` and `assignmentAudienceUserRecipients`, and `server/api/edu/handlers/assignments.ts` depends on them. Deleting the field without first moving these queries to enrollments makes realtime assignment delivery return an empty recipient set silently.

Two obligations follow. The realtime recipient resolution moves to canonical enrollments in Workstream B1, before any field removal. The architecture check covers class-projection queries on `users` as well as on `students`; a rule scoped only to the `students` collection would report success while delivery was broken.

The smoke suite therefore includes a realtime-recipient probe alongside the other surfaces, so that a regression in this path fails a gate rather than going unnoticed until a teacher reports missing notifications.

## Workstream decomposition

The global invariants in this document apply to every workstream below.

### Phase 0 — Discovery and shared foundation

Read-only and first. Deliver the recursive production reference inventory, the legacy soft-merge census, the denormalized-field coverage count, the finance-anomaly classification, and the frozen baseline. Deliver the shared identity contracts that more than one workstream imports: alias and tombstone schemas and predicates, and the server-side canonical read-mode control record.

The shared contracts belong here rather than inside a single workstream because Workstream A's progression writer needs the read-mode control to decide whether to write compatibility projections, while Workstream B needs A's alias predicates. Placing both in Phase 0 removes that interleaving.

Phase 0 also delivers the additive `admissionSearch*` backfill, which is a prerequisite for A's creation guard and is safe to run under normal operations.

### Workstream A — Canonical identity and progression

Deliver code registry, canonical resolver, maintenance guard foundation, canonical profile creation, promotion, class closing, transfer alignment, enrollment invariants, and linked-user consistency.

### Workstream B1 — Alias-safety-critical reads

Deliver the read surfaces that must be correct before any profile is retired: authentication and authorization resolution, the student profile route, class rosters from enrollments, wallet and accounting summaries that exclude aliases and tombstones, and the realtime recipient resolution that currently depends on the linked-user class projection.

B1 gates the cutover.

### Workstream B2 — Remaining canonical reads and projections

Deliver directory and headcount, dashboards, reports and exports, frontend identity consumption, and required-mode readiness. Workstream D performs the actual `canonical_required` switch during the maintenance window; B2 delivers the code and the readiness signal it consumes.

B2 also completes before cutover. It could technically follow it, because a canonical profile keeps serving its own compatibility projections correctly once the duplicates are gone, but deferring it would mean reopening writes with dashboards, reports, and exports still deciding student identity from physical rows. The program accepts the additional schedule cost to avoid that state.

The B1/B2 split therefore remains a sequencing and review boundary rather than a cutover boundary: B1 lands first because it gates alias safety, B2 second, both before the maintenance window.

### Workstream C — Audit and merge engine v2

Deliver the typed reference registry derived from Phase 0, candidate detection including the legacy soft-merge class, reconciliation, manifest and digest, apply and journal, verification, rollback planner, and snapshot-rehearsal support.

### Workstream D — Production cutover and retirement

Deliver runbook, managed-export gate, production dry-run review, maintenance cutover, smoke and global verification, monitoring, forward-repair procedures, and timed legacy deletion and fallback removal.

D's mutation-guard inventory, health service, health persistence, and maintenance transition CLI are prerequisites of the A/B1 stability observation window, not consequences of it, because that window requires the maintenance control document to exist and the required-mode flag to be set. They are scheduled alongside A rather than after it.

### Ordering

Phase 0 precedes everything. A, B1, and B2 must be deployed and stable before Workstream C may apply production data; B1 lands before B2. Workstream C must pass a full snapshot rehearsal before Workstream D begins production cutover.

## Success criteria

The program is complete only when:

1. no student operation can create a second profile for an existing human;
2. course progression preserves profile IDs and is idempotent;
3. all application reads expose one canonical student with unified academic and financial history;
4. all approved production duplicates are normalized with exact financial preservation and auditable identity decisions;
4b. every legacy soft-merge record has a valid alias, a claimed code, a canonical tombstone, and a verified reference closure;
5. all global post-apply invariants remain green for seven consecutive daily audits;
6. inaccessible legacy profile and credential tombstones are retired after at least 30 days while aliases continue resolving old links;
7. legacy profile-per-class fallbacks and authoritative presentation deduplication are removed;
8. documentation, runbooks, tests, rules, indexes, health checks, and recovery procedures are committed and verified.
