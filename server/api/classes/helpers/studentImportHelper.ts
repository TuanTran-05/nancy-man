import { withStudentIdentityMutationLease } from '../../lib/maintenance/studentIdentityMutationLease.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  progressStudentToClass,
  type ProgressStudentToClassResult,
  type StudentProgressionKind,
  type StudentProgressionMutationOperation,
} from '../../lib/student/studentProgression.js';
import {
  STUDENT_COURSE_ENROLLMENTS_COLLECTION,
  tryResolveClassCurrentTerm,
} from '../../lib/student/courseEnrollmentRepository.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import { isOpenStudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';

/**
 * Moving a cohort from one class to the next.
 *
 * This used to clone. For every student on the source roster it created a fresh
 * `students/{autoId}`, copied name, contact, face image and auth flags across,
 * copied the credential document, repointed the linked user documents at the
 * copy, and stamped the original `enrollmentStatus: 'promoted'`. The result was
 * two documents for one child, each owning the same business code, with money
 * attached to whichever one a given feature happened to read. Fifty-nine codes
 * in production are in that state, and this function is why.
 *
 * It is now an orchestrator. It picks the eligible source enrollments and calls
 * `progressStudentToClass` once per profile; that transaction owns everything
 * that used to happen in a batch here. Two consequences are deliberate:
 *
 * - The roster comes from `student_course_enrollments`, not `students.classId`.
 *   The profile field is a projection that goes stale; reading it is how a
 *   student who had already left got promoted a second time.
 * - Each profile is its own transaction. A cohort is therefore partial on
 *   failure, and that is the correct trade: the alternative is one transaction
 *   large enough to exceed DocumentStore's limits, and a failure that silently
 *   rolls back students who moved correctly.
 */

export type ClassProgressionSummary = {
  eligibleCount: number;
  progressedCount: number;
  replayedCount: number;
  skippedCount: number;
  failures: Array<{ profileId: string; code: string }>;
  rolloverBalance: number;
  createdLedgerCount: number;
  affectedClassIds: string[];
  /**
   * Compatibility with the audit entries and API responses that already read
   * these names. `importedCount` never meant "documents created" to a caller —
   * it meant "students who moved" — so it keeps that meaning honestly now.
   */
  importedCount: number;
  skippedDuplicates: number;
  linkedExistingCount: number;
};

export type ImportStudentsFromClassInput = {
  sourceClassId: string;
  targetClassId: string;
  teacherId: string;
  targetGrade?: number | null;
  actorId: string;
  mutationOperation: StudentProgressionMutationOperation;
  kind: StudentProgressionKind;
  /** Defaults to the target class's current term. */
  targetTermStart?: string;
  requestedJoinedAt?: string;
  now?: string;
};

/** Bounded so a large cohort cannot open hundreds of DocumentStore transactions at once. */
const PROGRESSION_CONCURRENCY = 4;

function emptySummary(): ClassProgressionSummary {
  return {
    eligibleCount: 0,
    progressedCount: 0,
    replayedCount: 0,
    skippedCount: 0,
    failures: [],
    rolloverBalance: 0,
    createdLedgerCount: 0,
    affectedClassIds: [],
    importedCount: 0,
    skippedDuplicates: 0,
    linkedExistingCount: 0,
  };
}

type SourceRecord = {
  profileId: string;
  status: string;
  termStart: string;
};

/**
 * One candidate per profile: the open source enrollment if there is one,
 * otherwise the latest completed one. Dropped, transferred, and superseded
 * records are excluded here; whether the candidate is *globally* eligible —
 * no open enrollment in some other class — is decided by the progression
 * transaction, which is the only place that can decide it serializably.
 */
function selectCandidates(records: SourceRecord[]): {
  candidates: string[];
  skipped: number;
} {
  const byProfile = new Map<string, SourceRecord[]>();
  for (const record of records) {
    const bucket = byProfile.get(record.profileId);
    if (bucket) bucket.push(record);
    else byProfile.set(record.profileId, [record]);
  }

  const candidates: string[] = [];
  let skipped = 0;
  for (const [profileId, rows] of byProfile) {
    const open = rows.find((row) =>
      isOpenStudentCourseEnrollmentStatus(row.status as never)
    );
    if (open) {
      candidates.push(profileId);
      continue;
    }
    const completed = rows
      .filter((row) => row.status === 'completed')
      .sort((a, b) => (a.termStart < b.termStart ? -1 : a.termStart > b.termStart ? 1 : 0));
    if (completed.length > 0) candidates.push(profileId);
    else skipped += 1;
  }
  return { candidates, skipped };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function importStudentsFromClass(
  db: DocumentStore,
  input: ImportStudentsFromClassInput
): Promise<ClassProgressionSummary> {
  if (!input.sourceClassId || !input.targetClassId) return emptySummary();

  // One transaction per student, so the pass outlives any single maintenance
  // check. The lease makes it visible to the drain check — a release cannot be
  // proven while a cohort is halfway moved — and the abort signal stops the
  // remaining students rather than the whole run.
  return withStudentIdentityMutationLease(
    db,
    { operation: input.mutationOperation, actorId: input.actorId },
    ({ signal }) => progressCohort(db, input, signal)
  );
}

async function progressCohort(
  db: DocumentStore,
  input: ImportStudentsFromClassInput,
  signal: AbortSignal
): Promise<ClassProgressionSummary> {

  const targetClassSnap = await db.collection('classes').doc(input.targetClassId).get();
  if (!targetClassSnap.exists) return emptySummary();
  const targetClass = (targetClassSnap.data() || {}) as Record<string, unknown>;

  const now = input.now ?? new Date().toISOString();
  const today = getVietnamTodayStr(new Date(now));
  const term = tryResolveClassCurrentTerm(targetClass, today);
  const targetTermStart =
    input.targetTermStart || term?.termStart || String(targetClass.startDate || '');
  if (!targetTermStart) {
    // Without a term there is no enrollment tuple and no ledger identity, so
    // there is nothing to progress into. Better an empty result than a cohort
    // of enrollments keyed on an empty string.
    return emptySummary();
  }
  // The whole cohort joins at the course start, not on the day someone pressed
  // the button. Clamping to today would mark every session between the course
  // start and the import as `not_enrolled` for every student in the class.
  const requestedJoinedAt = input.requestedJoinedAt || targetTermStart;

  const sourceSnap = await db
    .collection(STUDENT_COURSE_ENROLLMENTS_COLLECTION)
    .where('classId', '==', input.sourceClassId)
    .get();
  const records: SourceRecord[] = sourceSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      profileId: String(data.studentId || ''),
      status: String(data.status || ''),
      termStart: String(data.termStart || ''),
    };
  }).filter((record) => record.profileId !== '');

  const { candidates, skipped } = selectCandidates(records);
  const summary = emptySummary();
  summary.eligibleCount = candidates.length;
  summary.skippedCount = skipped;
  if (candidates.length === 0) return summary;

  type ProgressionOutcome = {
    profileId: string;
    result: ProgressStudentToClassResult | null;
    code: string | null;
  };

  const outcomes = await mapWithConcurrency<string, ProgressionOutcome>(
    candidates,
    PROGRESSION_CONCURRENCY,
    async (profileId) => {
      // The window closed, or the lease was lost mid-cohort. Remaining
      // students are reported as failures rather than silently skipped, so
      // the operator sees who did not move.
      if (signal.aborted) {
        return { profileId, result: null, code: 'STUDENT_IDENTITY_LEASE_ABORTED' };
      }
      try {
        const result = await progressStudentToClass(db, {
          profileId,
          sourceClassId: input.sourceClassId,
          targetClassId: input.targetClassId,
          targetTermStart,
          requestedJoinedAt,
          kind: input.kind,
          actorId: input.actorId,
          mutationOperation: input.mutationOperation,
          now,
          targetGrade: input.targetGrade ?? null,
        });
        return { profileId, result, code: null };
      } catch (error) {
        // One student's failure is reported, not thrown: the rest of the cohort
        // has already moved in its own committed transactions, and unwinding
        // those would mean re-cloning exactly what this rewrite removed.
        return {
          profileId,
          result: null,
          code: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  const affected = new Set<string>();
  for (const outcome of outcomes) {
    if (!outcome.result) {
      summary.failures.push({ profileId: outcome.profileId, code: outcome.code ?? 'UNKNOWN' });
      continue;
    }
    if (outcome.result.replayed) summary.replayedCount += 1;
    else {
      summary.progressedCount += 1;
      summary.rolloverBalance += outcome.result.rolloverBalance;
      if (outcome.result.targetLedgerCreated) summary.createdLedgerCount += 1;
    }
    for (const classId of outcome.result.affectedClassIds) affected.add(classId);
  }
  summary.affectedClassIds = [...affected].sort();
  summary.importedCount = summary.progressedCount;
  // A repeat run finds the progression event and changes nothing. That is the
  // successor to "this student already exists in the target class", so the two
  // legacy counters both report it.
  summary.skippedDuplicates = summary.replayedCount;
  summary.linkedExistingCount = summary.replayedCount;
  return summary;
}
