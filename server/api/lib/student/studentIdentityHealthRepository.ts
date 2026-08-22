import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';
import type { StudentIdentityHealthReport } from './studentIdentityHealthTypes.js';

/**
 * Where health audits live, and why they cannot be rewritten.
 *
 * The seven-day green streak gates deletion of tombstones and credentials —
 * the one irreversible step in the whole program. A day that was red is a day
 * the data was not safe, whatever a later run says about it, so the first
 * marker written for a Vietnam date wins permanently.
 *
 * A retry with the same digest is an idempotent success, because cron retries
 * and paging somebody for a job that already did its work is noise. A retry
 * with a *different* digest is a disagreement about what was true that day,
 * and it is recorded as a conflict rather than resolved by whoever wrote last.
 */

export const STUDENT_IDENTITY_HEALTH_RUNS = 'student_identity_health_runs';
export const STUDENT_IDENTITY_HEALTH = 'student_identity_health';
export const STUDENT_IDENTITY_HEALTH_CONFLICTS = 'student_identity_health_conflicts';

export type StudentIdentityHealthWriteOutcome = {
  auditId: string;
  /** Whether the stored run was created, matched, or refused as a rewrite. */
  runOutcome: 'created' | 'unchanged' | 'conflict';
  markerPath: string | null;
  markerOutcome: 'created' | 'unchanged' | 'conflict' | 'not_applicable';
  conflict: { path: string; existingDigest: string; incomingDigest: string } | null;
};

/** The non-sensitive summary the exit gate and dashboards read. */
function pointer(report: StudentIdentityHealthReport) {
  return {
    auditId: report.auditId,
    mode: report.mode,
    status: report.status,
    vietnamDate: report.vietnamDate,
    checkedAt: report.checkedAt,
    digest: report.digest,
    runId: report.runId,
    blockerCount: report.blockers.length,
    canonicalReadMode: report.canonicalReadMode,
  };
}

function markerPathFor(report: StudentIdentityHealthReport): string | null {
  if (report.mode === 'daily') return `${STUDENT_IDENTITY_HEALTH}/daily_${report.vietnamDate}`;
  if (report.mode === 'cutover' && report.runId) {
    // Evidence about one run, not about a calendar day. Filing it as a day
    // would let a maintenance window substitute for a day of normal operation
    // in the streak.
    return `${STUDENT_IDENTITY_HEALTH}/cutover_${report.runId}`;
  }
  return null;
}

export async function writeStudentIdentityHealthReport(
  db: DocumentStore,
  report: StudentIdentityHealthReport
): Promise<StudentIdentityHealthWriteOutcome> {
  // The stored run is evidence, so it is written once. An audit id carries
  // only the first twelve hex of the digest, which is not enough to make
  // "same id" mean "same report" — the write compares the full digest and
  // refuses anything that would change what a stored day says.
  const runOutcome = await db.runTransaction(async (tx: Transaction) => {
    const runRef = db.collection(STUDENT_IDENTITY_HEALTH_RUNS).doc(report.auditId);
    const snapshot = (await tx.get(runRef as never)) as unknown as {
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    };
    if (!snapshot.exists) {
      tx.set(runRef as never, report as never);
      return 'created' as const;
    }
    const storedDigest = String((snapshot.data() || {}).digest || '');
    return storedDigest === report.digest ? ('unchanged' as const) : ('conflict' as const);
  });

  const path = markerPathFor(report);
  if (!path) {
    // A conflicting run must not advance the pointer either; the pointer is
    // how readers find "the current answer".
    if (runOutcome !== 'conflict') {
      await db.collection(STUDENT_IDENTITY_HEALTH).doc('current').set(pointer(report) as never);
    }
    return {
      auditId: report.auditId,
      runOutcome,
      markerPath: null,
      markerOutcome: 'not_applicable',
      conflict: null,
    };
  }

  const outcome = await db.runTransaction(async (tx: Transaction) => {
    const ref = db.doc(path);
    const snapshot = (await tx.get(ref as never)) as unknown as {
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    };

    if (!snapshot.exists) {
      tx.set(ref as never, { ...pointer(report), firstWrittenAt: report.checkedAt });
      return { markerOutcome: 'created' as const, conflict: null };
    }

    const existing = snapshot.data() || {};
    const existingDigest = String(existing.digest || '');
    if (existingDigest === report.digest) {
      return { markerOutcome: 'unchanged' as const, conflict: null };
    }

    // Deliberately not written. The first answer for a date stands.
    return {
      markerOutcome: 'conflict' as const,
      conflict: {
        path: `${STUDENT_IDENTITY_HEALTH_CONFLICTS}/${report.vietnamDate}_${report.digest.slice(0, 16)}`,
        existingDigest,
        incomingDigest: report.digest,
      },
    };
  });

  if (outcome.conflict) {
    // Keyed by date + incoming digest, so a job retrying the same disagreement
    // raises one alert rather than one per attempt.
    await db.doc(outcome.conflict.path).set({
      vietnamDate: report.vietnamDate,
      mode: report.mode,
      existingDigest: outcome.conflict.existingDigest,
      incomingDigest: outcome.conflict.incomingDigest,
      incomingStatus: report.status,
      incomingAuditId: report.auditId,
      detectedAt: report.checkedAt,
    } as never);
  }

  if (runOutcome !== 'conflict') {
    await db.collection(STUDENT_IDENTITY_HEALTH).doc('current').set(pointer(report) as never);
  }

  return {
    auditId: report.auditId,
    runOutcome,
    markerPath: path,
    markerOutcome: outcome.markerOutcome,
    conflict: outcome.conflict,
  };
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export async function readConsecutiveGreenStudentIdentityAudits(input: {
  db: DocumentStore;
  endingVietnamDate: string;
  requiredDays: number;
}): Promise<{ valid: boolean; auditIds: string[]; missingDates: string[] }> {
  const auditIds: string[] = [];
  const missingDates: string[] = [];

  let date = input.endingVietnamDate;
  for (let index = 0; index < input.requiredDays; index += 1) {
    const snapshot = (await input.db
      .doc(`${STUDENT_IDENTITY_HEALTH}/daily_${date}`)
      .get()) as unknown as { exists: boolean; data: () => Record<string, unknown> | undefined };

    const data = snapshot.exists ? snapshot.data() || {} : null;
    // Only a marker whose own mode is `daily` counts. A cutover audit is
    // evidence about a maintenance window, and a window is not a day of
    // ordinary operation.
    if (!data || data.mode !== 'daily' || data.status !== 'green') {
      missingDates.push(date);
    } else {
      auditIds.push(String(data.auditId || ''));
    }
    date = previousDate(date);
  }

  return {
    valid: missingDates.length === 0 && auditIds.length === input.requiredDays,
    auditIds,
    missingDates,
  };
}
