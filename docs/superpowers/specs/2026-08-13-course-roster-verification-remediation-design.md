# Course Roster Verification Remediation Design

**Date:** 2026-08-13

**Scope:** Restore repository-wide TypeScript verification and make the course-term roster fallback honor malformed class start dates.

## Problem

The roster consistency implementation passes its focused and broader tests, lint, architecture checks, and the production build, but repository-wide `tsc --noEmit` currently fails. The remaining errors come from incomplete attendance UI/server typing and an untracked audit script included by the TypeScript project. Separately, the roster design requires legacy fallback for missing or malformed `startDate`, while the loader currently treats every non-empty string as a usable term.

## Design

1. Add one regression case to `courseTermRoster.test.ts` proving an invalid term such as `not-a-date` uses the legacy `students.classId` roster and does not query course enrollments.
2. Normalize a roster scope's `termStart` to an ISO `YYYY-MM-DD` value only when it is a real calendar date; missing, whitespace-only, malformed, and impossible dates become `undefined` and use the existing fallback path.
3. Complete the attendance changes already present in the working tree by adding the missing public prop types and imports, using the toast API supported by the installed `react-hot-toast`, and fixing the heterogeneous eligibility-resolver map type.
4. Fix the attendance API class value at its source by constructing the required `ClassLike` shape with the document ID.
5. Give the audit script's `compact` helper a type that preserves Firestore document fields so its diagnostic rows remain type-safe. The script stays untracked unless the user later chooses to add it.

## Safety and Scope

- Preserve all existing working-tree changes and do not replace the two concurrent attendance edits.
- Do not change Firestore data, canonical-read controls, roster status rules, or course-closing behavior.
- Do not exclude `scratch/` from TypeScript merely to hide compiler failures.
- Avoid unrelated refactors; each edit addresses an observed compiler error or the documented malformed-date gap.

## Verification

- Demonstrate RED then GREEN for malformed-term fallback.
- Run the focused roster and attendance tests affected by the typing changes.
- Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run check:student-identity-architecture`, and `npm.cmd run build`.
- Run the 34-test focused roster suite and the 185-test broader API suite.
- Inspect `git diff --check` and `git status --short` without staging unrelated files.
