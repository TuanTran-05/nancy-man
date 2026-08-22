# Workstream B Canonical Read Remediation Design

**Date:** 2026-08-10

**Status:** Approved for implementation planning

## Objective

Close the remaining Workstream B gaps so student identity is decided by server-side canonical profiles and enrollments on every serving path. The remediation must preserve the rollout modes, remove client-side identity authority, replace unbounded collection scans with bounded indexed reads, and retain the existing public response shapes during the pre-cutover window.

## Scope

The implementation covers four defects found during the Workstream B review:

1. Client, export, report, and dashboard surfaces still call the legacy presentation-deduplication helpers.
2. Assignment targeting validates class membership against `students.classId` instead of canonical enrollments.
3. Canonical directory reads load the full students, alias, and enrollment collections and perform unbounded per-profile reads.
4. Realtime recipient selection loads all student and parent users and resolves them one at a time.

The remediation also removes invalid architecture allowlist entries and adds the missing focused tests for B2 adapters and dashboard consumption. Production mode changes, data normalization, and legacy profile retirement remain outside this work.

## Architecture

### Server-owned identity

The canonical read repository remains the only component that decides whether a physical student document represents a served human identity. Alias resolution, profile exclusion, current placement, class membership, and canonical profile IDs stay on the server.

`legacy_compare` continues to return the legacy server response while recording non-sensitive discrepancies. `canonical_preferred` and `canonical_required` return canonical rows. Client code renders the response it receives and does not collapse rows by name, date of birth, contact, code, or profile status.

### Bounded canonical directory reads

Directory requests page student profile candidates with a stable Firestore cursor and a bounded limit. For the selected candidate IDs, the repository batch-loads alias records and queries matching enrollments in Firestore `in` chunks. Aliased physical profiles are skipped and the page is filled until it reaches the requested canonical row count or the candidate stream is exhausted.

Directory totals and placement buckets come from the versioned dashboard/read-model projection rather than loading every profile and enrollment during each request. The projection builder computes those counts directly from canonical open enrollments and bounded profile/alias batches; it does not call the paginated directory repository. This keeps the dependency one-way. If a required-mode count projection is missing, stale, or incomplete, the server returns the existing canonical invariant error instead of reconstructing totals from physical rows.

Class rosters retain their indexed `classId + status` enrollment query. Profile, alias, enrollment, and class enrichment uses bounded batches with explicit chunk sizes. No request creates an unbounded `Promise.all` over a collection-sized result.

### Assignment membership

Selected-student validation resolves each requested ID to its canonical profile and checks membership against the class's open canonical enrollments. A stale `students.classId` value cannot admit or reject a target. The handler keeps its existing error contract for a student who is not in the assignment class.

### Realtime recipients

Recipient selection starts from the class's open canonical enrollments. It resolves the enrolled IDs once, then fetches linked student and parent user documents using bounded `studentId in [...]` queries. Active/revoked filtering, assignment delivery policy, canonical-account preference, and user-ID deduplication remain unchanged.

An unresolvable enrollment or linked identity is recorded as an anomaly and contributes no recipient. It is never treated as a new canonical identity by falling back to the raw ID.

### Client, export, report, and dashboard consumption

Serving surfaces consume `canonicalProfileId`, `placementStatus`, `currentClassId`, and enrollment-derived compatibility fields returned by the server. `getCurrentStudentRecords`, `getCurrentStudentRoster`, and related helpers remain available only to explicitly named discrepancy or migration code.

The student directory export and report scope preserve their formatting and filtering responsibilities. They no longer choose which physical student row survives. Admin and teacher dashboard hooks use server aggregate counts and canonical directory rows; missing canonical data is surfaced as incomplete rather than guessed from physical records.

## Error Handling

- Stale or malformed pagination cursors return the existing stable cursor error.
- Multiple open enrollments and underivable placement remain canonical anomalies; required-mode serving fails according to the shared control policy.
- Assignment targets outside the canonical roster return HTTP 400 with the existing message.
- Missing or stale canonical aggregate projections fail closed in `canonical_required`.
- Realtime identity resolution failures omit the affected recipient and emit non-PII anomaly metadata.

## Architecture Policy

Remove serving components, hooks, exports, and reports from the pre-cutover `anomaly_report` allowlist. The allowlist may retain only code whose output is diagnostic and cannot affect user-visible rows, authorization, delivery, finance, or counts.

The pre-cutover scanner must reject any reintroduction of presentation deduplication or authoritative `students.classId` membership reads in Workstream B surfaces.

## Testing Strategy

Each defect follows a separate red-green cycle:

- Export, report, directory, class-detail, and dashboard tests fail if a legacy identity helper is invoked.
- Assignment tests cover stale profile projections in both directions: enrolled despite an old profile class, and no longer enrolled despite a stale matching class.
- Repository tests assert bounded profile pagination, chunked alias/enrollment reads, stable cursors, and absence of full-collection reads.
- Realtime tests assert no all-user scan, chunk boundaries, alias resolution, revoked filtering, and the no-`classId` regression.
- Adapter tests cover canonical admin-report, finance, directory, and dashboard response handling.
- Architecture tests reject each removed allowlist entry.

The final gate runs all Workstream B focused suites, Firestore index tests, the pre-cutover architecture policy, TypeScript typecheck, production build, and `git diff --check`.

## Completion Criteria

Workstream B remediation is complete when:

- no user-serving path calls a legacy student identity heuristic;
- assignment and realtime membership derive from canonical enrollments;
- ordinary directory, roster, and recipient requests perform bounded indexed reads;
- the pre-cutover allowlist contains no serving path mislabeled as an anomaly report;
- every new regression passes with the complete Workstream B verification gate;
- the repository contains no implementation changes outside this remediation scope.
