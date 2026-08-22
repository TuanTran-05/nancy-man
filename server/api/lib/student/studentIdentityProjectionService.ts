import type { DocumentStore } from '@/server/db/documentStore.js';
import { readCanonicalStudentReadControl } from './canonicalStudentReadControl.js';
import {
  buildAccountingProjectionHealth,
  writeAccountingProjectionHealth,
} from '../accounting/studentFinanceProjectionRepository.js';
import {
  isCanonicalStudentProfile,
  isStudentProfileAlias,
} from '../../../../shared/studentIdentity.js';
import { isOpenStudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';
import type { StudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';

/**
 * Rebuilds what the merge invalidated, and refuses to run before it can.
 *
 * Every projection here is derived: accounting summaries, the dashboard model,
 * class counts. After a merge they describe a world that no longer exists —
 * two rows for one child, a headcount that counts them twice, a class roster
 * built from a profile field the enrollment has moved past.
 *
 * Two rules make this safe to run inside a maintenance window:
 *
 * - **It runs only once reads serve `canonical_required`.** Rebuilding while
 *   reads still resolve the old way would write the old answer back into the
 *   projection and call it repaired.
 * - **It never touches money and never touches maintenance.** A rebuild that
 *   could adjust a balance would be a second, unreviewed migration; a rebuild
 *   that could lift the window would be a way around the gate.
 *
 * Pruning happens only under `--apply`. A dry run that deleted a summary would
 * be a dry run in name only, and this is the command an operator reaches for
 * to find out what a rebuild *would* do.
 */

export type StudentIdentityProjectionRebuildResult = {
  runId: string;
  applied: boolean;
  canonicalProfiles: number;
  summariesWritten: number;
  summariesPruned: number;
  dashboardCanonicalProfiles: number;
  dashboardOpenEnrollments: number;
  classCountMismatches: string[];
  valid: boolean;
  blockers: string[];
  /**
   * The document the release gate names as proof this rebuild happened.
   * Null when nothing was applied — a dry run proves nothing.
   */
  evidenceId: string | null;
};

export const STUDENT_IDENTITY_PROJECTION_REBUILDS = 'student_identity_projection_rebuilds';

type Doc = { id: string; data: Record<string, unknown> };

type CollectionRead =
  | { ok: true; name: string; docs: Doc[] }
  | { ok: false; name: string; detail: string };

/**
 * A collection that could not be read is not an empty collection.
 *
 * Swallowing the error here would make an outage look like a center with no
 * aliases, and a rebuild computed from that would prune every summary it
 * could not account for.
 */
async function readCollection(db: DocumentStore, name: string): Promise<CollectionRead> {
  try {
    const snapshot = await db.collection(name).get();
    return {
      ok: true,
      name,
      docs: (snapshot.docs || []).map((doc) => ({ id: doc.id, data: doc.data() || {} })),
    };
  } catch (error) {
    return { ok: false, name, detail: error instanceof Error ? error.message : String(error) };
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function rebuildStudentIdentityProjections(input: {
  db: DocumentStore;
  apply: boolean;
  runId: string;
  now?: Date;
}): Promise<StudentIdentityProjectionRebuildResult> {
  const db = input.db;
  const now = input.now ?? new Date();
  const blockers: string[] = [];

  const control = await readCanonicalStudentReadControl(db);
  if (control.mode !== 'canonical_required') {
    // Rebuilding under the old read mode writes the old answer back into the
    // projection and calls it repaired.
    return {
      runId: input.runId,
      applied: false,
      canonicalProfiles: 0,
      summariesWritten: 0,
      summariesPruned: 0,
      dashboardCanonicalProfiles: 0,
      dashboardOpenEnrollments: 0,
      classCountMismatches: [],
      valid: false,
      evidenceId: null,
      blockers: [`STUDENT_IDENTITY_READ_MODE_NOT_REQUIRED: serving ${control.mode}`],
    };
  }

  const reads = await Promise.all([
    readCollection(db, 'students'),
    readCollection(db, 'student_profile_aliases'),
    readCollection(db, 'student_course_enrollments'),
    readCollection(db, 'accounting_student_summaries'),
    readCollection(db, 'classes'),
  ]);

  const unreadable = reads.filter((read) => !read.ok);
  if (unreadable.length > 0) {
    return {
      runId: input.runId,
      applied: false,
      canonicalProfiles: 0,
      summariesWritten: 0,
      summariesPruned: 0,
      dashboardCanonicalProfiles: 0,
      dashboardOpenEnrollments: 0,
      classCountMismatches: [],
      valid: false,
      evidenceId: null,
      blockers: unreadable.map(
        (read) => `STUDENT_IDENTITY_PROJECTION_SOURCE_UNAVAILABLE: ${read.name}`
      ),
    };
  }

  const [students, aliases, enrollments, summaries, classes] = reads.map((read) =>
    read.ok ? read.docs : []
  );

  const aliasedAway = new Set(
    aliases.filter((doc) => isStudentProfileAlias(doc.data)).map((doc) => doc.id)
  );
  const canonical = students.filter(
    (doc) => isCanonicalStudentProfile(doc.data) && !aliasedAway.has(doc.id)
  );
  const canonicalIds = new Set(canonical.map((doc) => doc.id));
  const tombstoneCount = students.filter(
    (doc) => doc.data.studentProfileState === 'merged_tombstone'
  ).length;

  // --- accounting summaries -----------------------------------------------
  const stale = summaries.filter((doc) => !canonicalIds.has(doc.id));
  const missing = canonical.filter((doc) => !summaries.some((entry) => entry.id === doc.id));

  let summariesPruned = 0;
  let summariesWritten = 0;
  if (input.apply) {
    for (const doc of stale) {
      await db.collection('accounting_student_summaries').doc(doc.id).delete();
      summariesPruned += 1;
    }
    for (const doc of missing) {
      // A placeholder at version 3, so the projection is complete and the
      // accounting rebuild service fills the figures on its own pass. Writing
      // money here would make this a second, unreviewed migration.
      await db
        .collection('accounting_student_summaries')
        .doc(doc.id)
        .set({ studentId: doc.id, sourceVersion: 3, rebuiltAt: now.toISOString() } as never, {
          merge: true,
        });
      summariesWritten += 1;
    }
  }

  // --- class counts --------------------------------------------------------
  const openByClass = new Map<string, Set<string>>();
  for (const doc of enrollments) {
    const status = text(doc.data.status) as StudentCourseEnrollmentStatus;
    if (!isOpenStudentCourseEnrollmentStatus(status)) continue;
    const classId = text(doc.data.classId);
    const studentId = text(doc.data.studentId);
    if (!classId || !studentId || !canonicalIds.has(studentId)) continue;
    const bucket = openByClass.get(classId) ?? new Set<string>();
    bucket.add(studentId);
    openByClass.set(classId, bucket);
  }

  const classCountMismatches: string[] = [];
  for (const classDoc of classes) {
    const stored = Number(classDoc.data.studentCount ?? NaN);
    if (!Number.isFinite(stored)) continue;
    const derived = openByClass.get(classDoc.id)?.size ?? 0;
    if (stored !== derived) classCountMismatches.push(classDoc.id);
  }

  const openEnrollments = [...openByClass.values()].reduce(
    (total, members) => total + members.size,
    0
  );

  const health = buildAccountingProjectionHealth({
    eligibleCanonicalProfiles: canonical.length,
    physicalStudentDocumentCount: students.length,
    canonicalProfileCount: canonical.length,
    aliasCount: aliasedAway.size,
    tombstoneCount,
    summaryCount: input.apply ? summaries.length - summariesPruned + summariesWritten : summaries.length,
    aliasOrTombstoneSummaryCount: input.apply ? 0 : stale.length,
    orphanSummaryCount: 0,
    repairBacklog: input.apply ? 0 : missing.length,
    computedAt: now.toISOString(),
  });

  if (input.apply) {
    await writeAccountingProjectionHealth(db, health);
  }

  if (!health.complete) {
    blockers.push(
      `STUDENT_IDENTITY_PROJECTION_INCOMPLETE: ${missing.length} missing, ${stale.length} stale`
    );
  }
  if (classCountMismatches.length > 0) {
    blockers.push(
      `STUDENT_IDENTITY_CLASS_COUNT_MISMATCH: ${classCountMismatches.length} class(es)`
    );
  }

  const valid = blockers.length === 0;

  // Evidence only for a run that actually wrote something. A dry run proves
  // nothing, and evidence it produced could be presented at the gate as if it
  // had.
  let evidenceId: string | null = null;
  if (input.apply) {
    evidenceId = `${input.runId}_${now.toISOString().replace(/[:.]/g, '-')}`;
    const evidence = {
      evidenceId,
      runId: input.runId,
      status: valid ? 'valid' : 'invalid',
      missingCount: missing.length - summariesWritten,
      staleCount: stale.length - summariesPruned,
      classCountMismatchCount: classCountMismatches.length,
      canonicalProfiles: canonical.length,
      summariesWritten,
      summariesPruned,
      recordedAt: now.toISOString(),
      blockers,
    };
    await db.runTransaction(async (tx) => {
      const ref = db.collection(STUDENT_IDENTITY_PROJECTION_REBUILDS).doc(evidenceId as string);
      const snapshot = (await tx.get(ref as never)) as unknown as { exists: boolean };
      if (snapshot.exists) {
        // Evidence is written once. A second rebuild under the same run must
        // file its own record rather than restate the first.
        throw new Error(
          `STUDENT_IDENTITY_REBUILD_EVIDENCE_IMMUTABLE: ${evidenceId} already recorded`
        );
      }
      tx.set(ref as never, evidence as never);
    });
  }

  return {
    runId: input.runId,
    applied: input.apply,
    canonicalProfiles: canonical.length,
    summariesWritten,
    summariesPruned,
    dashboardCanonicalProfiles: canonical.length,
    dashboardOpenEnrollments: openEnrollments,
    classCountMismatches,
    valid,
    evidenceId,
    blockers,
  };
}
