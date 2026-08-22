import type { DocumentStore, Query } from '@/server/db/documentStore.js';
import {
  getCurrentStudentHeadcount,
  getCurrentStudentRoster,
} from '../../../../shared/studentRecords.js';
import {
  buildDashboardReadModel,
  type DashboardReadModelV3,
} from '../../../../shared/dashboardReadModel.js';
import { readCanonicalStudentReadControl } from '../student/canonicalStudentReadControl.js';
import { collectCanonicalStudentDirectoryProjection } from '../student/canonicalStudentReadRepository.js';

export type DashboardReadModel = {
  id: 'dashboard_global';
  counts: {
    /** Raw `students` document count, including archived and duplicate records. */
    students: number;
    /**
     * Canonical headcount: current (enrolled + trial) students after identity
     * de-duplication. Matches what the students directory reports.
     */
    currentStudents: number;
    classes: number;
    activeClasses: number;
    teachers: number;
    pendingPayments: number;
    paymentsNeedingReview: number;
    failedNotifications: number;
  };
  classStudentCounts: Record<
    string,
    { total: number; active: number; onLeave: number; dropped: number; promoted: number }
  >;
  activeStudents: number;
  genderCounts: { male: number; female: number; other: number };
  performanceCounts: { excellent: number; good: number; fair: number; average: number };
  sourceVersions: {
    students: number;
  };
  /**
   * Present from `canonical_preferred` onwards. Kept beside the legacy counts
   * rather than replacing them: the physical and canonical totals legitimately
   * differ while tombstones are retained, and an operator needs to see the gap
   * rather than guess at it.
   */
  canonicalHeadcount?: DashboardReadModelV3;
  generatedAt: string;
  schemaVersion: number;
};

export const DASHBOARD_READ_MODEL_VERSION = 3;
export const DASHBOARD_READ_MODEL_MAX_AGE_MS = 26 * 60 * 60 * 1000;

export function isDashboardReadModelFresh(
  model: Record<string, any> | null | undefined,
  latestStudentSourceVersion: number,
  now = new Date()
): boolean {
  if (!model || Number(model.schemaVersion || 0) < DASHBOARD_READ_MODEL_VERSION) return false;
  if (typeof model.counts?.currentStudents !== 'number') return false;

  const generatedAt = Date.parse(String(model.generatedAt || ''));
  if (!Number.isFinite(generatedAt)) return false;
  const ageMs = now.getTime() - generatedAt;
  if (ageMs < 0 || ageMs > DASHBOARD_READ_MODEL_MAX_AGE_MS) return false;

  const modelStudentSourceVersion = Number(model.sourceVersions?.students);
  return (
    Number.isFinite(modelStudentSourceVersion) &&
    modelStudentSourceVersion >= latestStudentSourceVersion
  );
}

async function countQuery(query: Query): Promise<number> {
  const countable = query as Query & {
    count?: () => { get: () => Promise<{ data: () => { count?: number } }> };
  };
  if (typeof countable.count === 'function') {
    const snap = await countable.count().get();
    return Number(snap.data().count || 0);
  }
  const snap = await query.limit(10000).get();
  return snap.size;
}

export async function aggregateDashboardReadModel(db: DocumentStore): Promise<DashboardReadModel> {
  const [
    students,
    classes,
    activeClasses,
    teachers,
    pendingPayments,
    paymentsNeedingReview,
    failedNotifications,
    allStudentsSnap,
    evaluationsSnap,
    studentsEventSnap,
  ] = await Promise.all([
    countQuery(db.collection('students')),
    countQuery(db.collection('classes')),
    countQuery(db.collection('classes').where('status', '==', 'active')),
    countQuery(db.collection('users').where('role', '==', 'teacher')),
    countQuery(db.collection('payment_requests').where('status', '==', 'pending')),
    countQuery(db.collection('payment_requests').where('status', '==', 'needs_review')),
    countQuery(db.collection('zalo_notifications').where('status', '==', 'failed')),
    db
      .collection('students')
      .select(
        'classId',
        'enrollmentStatus',
        'studentLifecycle',
        'isRevoked',
        'deletedAt',
        'studentId',
        'name',
        'dob',
        'contact',
        'gender'
      )
      .get(),
    db.collection('evaluations').select('studentId', 'date', 'finalScore', 'totalScore').get(),
    db.collection('realtime_events').doc('students').get(),
  ]);

  // Canonical roster: de-duplicated current students. Every "total students"
  // surface derives from this list so the dashboard and the students directory
  // can never drift apart.
  const studentRecords = allStudentsSnap.docs.map((doc) => ({
    id: doc.id,
    studentId: doc.get('studentId'),
    classId: doc.get('classId'),
    studentLifecycle: doc.get('studentLifecycle'),
    enrollmentStatus: doc.get('enrollmentStatus'),
    isRevoked: doc.get('isRevoked'),
    deletedAt: doc.get('deletedAt'),
    name: doc.get('name'),
    dob: doc.get('dob'),
    contact: doc.get('contact'),
    gender: doc.get('gender'),
  }));
  // The headline total. In canonical modes it counts distinct canonical
  // profiles with an open enrollment; the legacy helpers below collapse
  // physical rows by matching codes, which is a guess that was wrong for every
  // one of the fifty-nine doubly-owned codes in production.
  const control = await readCanonicalStudentReadControl(db);
  let currentStudentRecords: typeof studentRecords;
  let currentStudents: number;
  let activeStudents: number;
  let canonicalModel: DashboardReadModelV3 | null = null;
  const generatedAt = new Date().toISOString();

  if (control.mode === 'legacy_compare') {
    currentStudentRecords = getCurrentStudentRoster(studentRecords);
    const headcount = getCurrentStudentHeadcount(studentRecords);
    currentStudents = headcount.total;
    activeStudents = headcount.active;
  } else {
    // The named complete traversal. This service is the writer of the
    // centre-wide canonical counts, so it is one of the few callers that
    // legitimately reads every canonical profile — through bounded pages, and
    // under the program's 3000-profile cap.
    const projection = await collectCanonicalStudentDirectoryProjection(db);
    const openStatuses = new Set(['trial', 'studying', 'on_leave']);
    const current = projection.rows.filter((row) => openStatuses.has(row.placementStatus));
    currentStudentRecords = current.map((row) => ({
      id: row.canonicalProfileId,
      studentId: row.profile.studentId,
      classId: row.currentClassId,
      studentLifecycle: row.placementStatus === 'trial' ? 'trial' : 'enrolled',
      enrollmentStatus: row.placementStatus === 'on_leave' ? 'on_leave' : 'active',
      isRevoked: row.profile.isRevoked,
      deletedAt: row.profile.deletedAt,
      name: row.profile.name,
      dob: row.profile.dob,
      contact: row.profile.contact,
      gender: row.profile.gender,
    })) as typeof studentRecords;
    currentStudents = current.length;
    activeStudents = projection.rows.filter((row) => row.placementStatus === 'studying').length;
    canonicalModel = buildDashboardReadModel({
      physicalStudentDocumentCount: students,
      aliasCount: students - projection.rows.length,
      tombstoneCount: allStudentsSnap.docs.filter(
        (doc) => doc.get('studentProfileState') === 'merged_tombstone'
      ).length,
      openEnrollmentCount: current.length,
      requiredModeBlockerCount: projection.anomalies.length,
      placementStatuses: projection.rows.map((row) => row.placementStatus),
      generatedAt,
      sourceUpdatedAt: generatedAt,
    });
  }

  // Use the same roster as the headline. Counting the raw `students`
  // collection here makes archived and retired documents reappear in the
  // per-class totals even though the headline correctly excludes them.
  const classStudentCounts: DashboardReadModel['classStudentCounts'] = {};
  for (const student of currentStudentRecords) {
    const classId = String(student.classId || '');
    if (!classId) continue;
    classStudentCounts[classId] ||= {
      total: 0,
      active: 0,
      onLeave: 0,
      dropped: 0,
      promoted: 0,
    };
    classStudentCounts[classId].total += 1;
    if (student.enrollmentStatus === 'on_leave') classStudentCounts[classId].onLeave += 1;
    else classStudentCounts[classId].active += 1;
  }

  // Built from the same roster as `currentStudents`, so the breakdown always
  // sums back to the reported total.
  const genderCounts = {
    male: currentStudentRecords.filter((student) => student.gender === 'male').length,
    female: currentStudentRecords.filter((student) => student.gender === 'female').length,
    other: currentStudentRecords.filter(
      (student) => student.gender !== 'male' && student.gender !== 'female'
    ).length,
  };

  const latestEvaluationByStudent = new Map<string, Record<string, unknown>>();
  for (const doc of evaluationsSnap.docs) {
    const evaluation = doc.data() || {};
    const studentId = String(evaluation.studentId || '');
    const date = String(evaluation.date || '');
    if (!studentId) continue;
    const current = latestEvaluationByStudent.get(studentId);
    if (!current || date > String(current.date || '')) {
      latestEvaluationByStudent.set(studentId, evaluation);
    }
  }

  const performanceCounts = { excellent: 0, good: 0, fair: 0, average: 0 };
  for (const evaluation of latestEvaluationByStudent.values()) {
    const raw = Number(evaluation.finalScore ?? evaluation.totalScore ?? 0);
    const score = raw <= 10 ? raw * 10 : raw;
    if (score >= 90) performanceCounts.excellent += 1;
    else if (score >= 80) performanceCounts.good += 1;
    else if (score >= 65) performanceCounts.fair += 1;
    else if (score > 0) performanceCounts.average += 1;
  }

  const model: DashboardReadModel = {
    id: 'dashboard_global',
    counts: {
      students,
      currentStudents,
      classes,
      activeClasses,
      teachers,
      pendingPayments,
      paymentsNeedingReview,
      failedNotifications,
    },
    classStudentCounts,
    activeStudents,
    genderCounts,
    performanceCounts,
    sourceVersions: {
      students: Number(studentsEventSnap.data()?.version || 0),
    },
    // Carried beside the legacy shape rather than replacing it: the physical
    // and canonical counts legitimately differ during normalization, and an
    // operator needs to see the gap rather than guess at it.
    ...(canonicalModel ? { canonicalHeadcount: canonicalModel } : {}),
    generatedAt,
    schemaVersion: DASHBOARD_READ_MODEL_VERSION,
  };

  await db.collection('read_models').doc(model.id).set(model, { merge: true });
  return model;
}
