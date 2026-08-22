/**
 * Audits and conservatively backfills course-closing state for legacy classes.
 *
 * Default mode is a read-only dry run. `--apply` is required to write anything.
 * The planner never sends Zalo messages, never resets a course and never
 * creates ledgers; ambiguous evidence is reported for Admin review instead of
 * being guessed into a completed state.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  isCurrentAcademicCourseRecord,
  isRequiredAcademicEvaluationStudent,
  selectFinalEvaluation,
} from '../shared/academic.js';
import { isRankedEvaluation } from '../shared/evaluationRank.js';
import type { CourseClosingState } from '../shared/courseClosing.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EVALUATION_TYPES = new Set(['evaluation_notice', 'evaluation']);
const RANK_TYPES = new Set(['rank_achievement', 'rank_notice', 'rank']);
const TUITION_TYPES = new Set(['tuition_notice', 'next_course_tuition']);

export type MigrationRecord = { id: string; data: Record<string, unknown> };
export type MigrationEvaluationRecord = MigrationRecord & { updatedAt?: string };

export interface CourseClosingMigrationInput {
  classId: string;
  classData: Record<string, unknown>;
  students: MigrationRecord[];
  evaluations: MigrationEvaluationRecord[];
  notifications: MigrationRecord[];
}

export interface CourseClosingMigrationPlan {
  classId: string;
  courseId: string;
  classUpdate?: Record<string, unknown>;
  notificationUpdates: Array<{
    notificationId: string;
    courseId: string;
    evaluationId?: string;
    evaluationVersion?: string;
  }>;
  ambiguousNotificationIds: string[];
  outcome: 'no_change' | 'partial' | 'completed' | 'needs_admin_review';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timeOf(value: unknown): number {
  const parsed = Date.parse(str(value));
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function channelOf(type: string): 'evaluation' | 'rank' | 'tuition' | null {
  if (EVALUATION_TYPES.has(type)) return 'evaluation';
  if (RANK_TYPES.has(type)) return 'rank';
  if (TUITION_TYPES.has(type)) return 'tuition';
  return null;
}

export function planCourseClosingMigration(
  input: CourseClosingMigrationInput
): CourseClosingMigrationPlan {
  const { classId, classData, students, evaluations, notifications } = input;
  const existingCourseId = str(classData.currentCourseId);
  const courseId = existingCourseId || randomUUID();

  const classUpdate: Record<string, unknown> = {};
  if (!existingCourseId) classUpdate.currentCourseId = courseId;

  const requiredStudents = students.filter(({ data }) => isRequiredAcademicEvaluationStudent(data));
  const requiredStudentIds = requiredStudents.map(({ id }) => id);

  // Pick the current final evaluation per required student with the shared rules.
  const finalByStudent = new Map<string, MigrationEvaluationRecord>();
  for (const studentId of requiredStudentIds) {
    const candidates = evaluations.filter(
      (record) =>
        str(record.data.studentId) === studentId &&
        isCurrentAcademicCourseRecord(record.data, classData)
    );
    const selected = selectFinalEvaluation(candidates.map((record) => record.data));
    if (!selected) continue;
    const match = candidates.find((record) => record.data === selected);
    if (match) finalByStudent.set(studentId, match);
  }

  const termStartTime = timeOf(classData.startDate);
  const notificationUpdates: CourseClosingMigrationPlan['notificationUpdates'] = [];
  const ambiguousNotificationIds: string[] = [];
  const proven = new Map<string, { evaluation: boolean; rank: boolean; tuition: boolean }>();
  const provenFor = (studentId: string) => {
    const current = proven.get(studentId) ?? { evaluation: false, rank: false, tuition: false };
    proven.set(studentId, current);
    return current;
  };

  for (const notification of notifications) {
    const { id, data } = notification;
    if (str(data.status) !== 'sent') continue;
    if (str(data.classId) !== classId) continue;

    const channel = channelOf(str(data.type));
    const studentId = str(data.studentId);
    if (!channel || !requiredStudentIds.includes(studentId)) continue;

    const existingCourse = str(data.courseId);
    // Never overwrite a non-empty evidence field with a different value.
    if (existingCourse && existingCourse !== courseId) {
      ambiguousNotificationIds.push(id);
      continue;
    }

    const sentAt = timeOf(data.createdAt);
    if (Number.isNaN(sentAt)) {
      ambiguousNotificationIds.push(id);
      continue;
    }
    // A log predating the current term cannot belong to the current course.
    if (!Number.isNaN(termStartTime) && sentAt < termStartTime) {
      ambiguousNotificationIds.push(id);
      continue;
    }

    if (channel === 'tuition') {
      if (!existingCourse) notificationUpdates.push({ notificationId: id, courseId });
      provenFor(studentId).tuition = true;
      continue;
    }

    const finalEvaluation = finalByStudent.get(studentId);
    if (!finalEvaluation) {
      ambiguousNotificationIds.push(id);
      continue;
    }

    const version = str(finalEvaluation.updatedAt);
    const versionTime = timeOf(version);
    // Only link when the current version provably existed before the send.
    if (Number.isNaN(versionTime) || versionTime > sentAt) {
      ambiguousNotificationIds.push(id);
      continue;
    }

    const existingEvaluationId = str(data.evaluationId);
    if (existingEvaluationId && existingEvaluationId !== finalEvaluation.id) {
      ambiguousNotificationIds.push(id);
      continue;
    }

    const alreadyLinked =
      existingCourse === courseId &&
      existingEvaluationId === finalEvaluation.id &&
      str(data.evaluationVersion) === version;
    if (!alreadyLinked) {
      notificationUpdates.push({
        notificationId: id,
        courseId,
        evaluationId: finalEvaluation.id,
        evaluationVersion: version,
      });
    }

    const record = provenFor(studentId);
    if (channel === 'evaluation') record.evaluation = true;
    else record.rank = true;
  }

  const everyRequirementProven =
    requiredStudentIds.length > 0 &&
    requiredStudentIds.every((studentId) => {
      const finalEvaluation = finalByStudent.get(studentId);
      if (!finalEvaluation) return false;
      const record = proven.get(studentId);
      if (!record?.evaluation || !record.tuition) return false;
      const rankNeeded = isRankedEvaluation(finalEvaluation.data.rank);
      return !rankNeeded || record.rank;
    });

  const hasAmbiguity = ambiguousNotificationIds.length > 0;
  const alreadyApproved = Boolean(
    (classData.courseClosing as CourseClosingState | undefined)?.approval
  );

  if (everyRequirementProven && !hasAmbiguity && !alreadyApproved) {
    // Fingerprints are recomputed by the server helper at apply time; the
    // planner records identity and provenance only.
    classUpdate.courseClosing = {
      courseId,
      termStart: str(classData.startDate),
      termEnd: str(classData.endDate),
      approval: {
        status: 'approved',
        source: 'migration',
        approvedAt: new Date(0).toISOString(),
        approvedBy: 'course-closing-migration',
        approvedByRole: 'system',
      },
    };
  }

  const outcome: CourseClosingMigrationPlan['outcome'] = hasAmbiguity
    ? 'needs_admin_review'
    : everyRequirementProven && (alreadyApproved || classUpdate.courseClosing)
      ? notificationUpdates.length === 0 && Object.keys(classUpdate).length === 0
        ? 'no_change'
        : 'completed'
      : notificationUpdates.length > 0 || Object.keys(classUpdate).length > 0
        ? 'partial'
        : 'no_change';

  return {
    classId,
    courseId,
    ...(Object.keys(classUpdate).length > 0 ? { classUpdate } : {}),
    notificationUpdates,
    ambiguousNotificationIds,
    outcome,
  };
}

const HELP_TEXT = `
migrate-course-closing-state

  Audits legacy classes and backfills course-closing identity/evidence.

  Usage:
    npm run audit:course-closing              Read-only dry run (default)
    npm run migrate:course-closing -- --apply Write safe class/log updates

  Flags:
    --apply     Commit planned changes. Without it nothing is written.
    --verbose   Print per-class plans in addition to totals.
    --help      Show this message and exit without connecting to DocumentStore.

  The migration never sends Zalo messages, never resets a course and never
  creates ledgers. Classes with ambiguous evidence are reported for Admin
  review rather than marked completed.
`;

export async function runCourseClosingMigration(options: { db: DocumentStore; apply: boolean }) {
  const { db, apply } = options;
  const classesSnap = await db.collection('classes').get();
  const totals = { no_change: 0, partial: 0, completed: 0, needs_admin_review: 0 };
  const plans: CourseClosingMigrationPlan[] = [];

  for (const classDoc of classesSnap.docs) {
    const classId = classDoc.id;
    const [studentsSnap, evaluationsSnap, notificationsSnap] = await Promise.all([
      db.collection('students').where('classId', '==', classId).get(),
      db.collection('evaluations').where('classId', '==', classId).get(),
      db.collection('zalo_notifications').where('classId', '==', classId).get(),
    ]);

    const plan = planCourseClosingMigration({
      classId,
      classData: classDoc.data() || {},
      students: studentsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
      evaluations: evaluationsSnap.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() || {},
        updatedAt: doc.updateTime?.toDate().toISOString(),
      })),
      notifications: notificationsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
    });

    totals[plan.outcome] += 1;
    plans.push(plan);
  }

  if (apply) {
    let batch = db.batch();
    let writes = 0;
    const flush = async () => {
      if (writes === 0) return;
      await batch.commit();
      batch = db.batch();
      writes = 0;
    };

    for (const plan of plans) {
      if (plan.classUpdate) {
        batch.update(db.collection('classes').doc(plan.classId), plan.classUpdate);
        writes += 1;
        if (writes >= 400) await flush();
      }
      for (const update of plan.notificationUpdates) {
        const { notificationId, ...fields } = update;
        batch.update(db.collection('zalo_notifications').doc(notificationId), fields);
        writes += 1;
        if (writes >= 400) await flush();
      }
    }
    await flush();
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    scannedClasses: classesSnap.size,
    ...totals,
    classUpdates: plans.filter((plan) => plan.classUpdate).length,
    notificationUpdates: plans.reduce((sum, plan) => sum + plan.notificationUpdates.length, 0),
    // Identifiers only: never print phone numbers or evaluation comments.
    needsReview: plans
      .filter((plan) => plan.outcome === 'needs_admin_review')
      .map((plan) => ({ classId: plan.classId, notifications: plan.ambiguousNotificationIds })),
    ...(process.argv.includes('--verbose') ? { plans } : {}),
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  // Parse help before opening PostgreSQL so documentation checks never connect.
  if (process.argv.includes('--help')) {
    console.log(HELP_TEXT.trim());
    return;
  }
  loadLocalEnv();
  await runCourseClosingMigration({
    db: getDocumentStore(),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
