import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  courseClosingRecordId,
  type ClosingDocumentType,
} from '../../../../shared/courseClosingRecords.js';
import {
  completeOutboxJob,
  createOutboxJob as defaultCreateOutboxJob,
} from '../../lib/jobs/outbox.js';
import {
  materializeCourseClosingDocument as defaultMaterializeCourseClosingDocument,
  materializeCourseClosingDocument,
} from './courseClosingRecordMaterializer.js';
import { upsertEvaluationRecord, upsertTuitionRecord } from './courseClosingRecordRepository.js';
import {
  buildEvaluationArchiveSnapshot,
  buildTuitionArchiveSnapshot,
} from './courseClosingRecordSnapshots.js';
import {
  CourseClosingRecordSourceError,
  loadCurrentMidtermEvaluation as defaultLoadCurrentMidtermEvaluation,
  resolveCourseClosingArchiveIdentity as defaultResolveCourseClosingArchiveIdentity,
} from './courseClosingRecordSources.js';
import { getNextCourseTuitionSchedule } from '../../zalo/helpers/tuitionDates.js';

export interface EvaluationArchiveInput {
  context: {
    courseId: string;
    classData: Record<string, unknown>;
    studentData: Record<string, unknown>;
    finalEvaluation?: Record<string, unknown>;
    finalEvaluationData?: Record<string, unknown>;
    evaluationId?: string;
    evaluationVersion: string;
  };
  actor: { uid: string; role?: string; name?: string };
  sourceNotificationId?: string;
}

export interface TuitionArchiveInput {
  context: {
    courseId: string;
    classData: Record<string, unknown>;
    studentData: Record<string, unknown>;
    finalEvaluation?: Record<string, unknown>;
    finalEvaluationData?: Record<string, unknown>;
    noticeDate?: string;
    tuitionAmount?: number;
    paymentDueDate?: string;
  };
  tuitionAmount: number;
  paymentDueDate: string;
  actor: { uid: string; role?: string; name?: string };
  sourceNotificationId?: string;
  ledgerId?: string;
}

export interface ArchiveOrchestrationDeps {
  createOutboxJob?: typeof defaultCreateOutboxJob;
  materialize?: (db: DocumentStore, payload: any) => Promise<void>;
  resolveIdentity?: typeof defaultResolveCourseClosingArchiveIdentity;
  loadMidterm?: typeof defaultLoadCurrentMidtermEvaluation;
}

export async function archiveEvaluationNotification(
  db: DocumentStore,
  input: EvaluationArchiveInput,
  deps: ArchiveOrchestrationDeps = {}
): Promise<'ready' | 'pending' | 'skipped'> {
  try {
    const resolveIdentity = deps.resolveIdentity || defaultResolveCourseClosingArchiveIdentity;
    const loadMidterm = deps.loadMidterm || defaultLoadCurrentMidtermEvaluation;

    const identity = await resolveIdentity(db, input.context, input.actor);
    const midtermEvaluation = await loadMidterm(db, input.context);

    const legacyFinalEvaluation = input.context.finalEvaluation || {};
    const canonicalFinalEvaluation = input.context.finalEvaluationData || {};
    const finalEval = {
      ...legacyFinalEvaluation,
      ...canonicalFinalEvaluation,
      id:
        input.context.evaluationId || canonicalFinalEvaluation.id || legacyFinalEvaluation.id || '',
    };
    const snapshot = buildEvaluationArchiveSnapshot({
      finalEvaluation: finalEval,
      evaluationVersion: input.context.evaluationVersion,
      midtermEvaluation,
    });

    const record = await upsertEvaluationRecord(db, {
      identity,
      snapshot,
      sourceNotificationId: input.sourceNotificationId,
    });

    const createJob = deps.createOutboxJob || defaultCreateOutboxJob;
    const idempotencyKey = `closing-record:${identity.courseId}:${identity.studentId}:evaluation:v1`;
    const jobId = await createJob(db, {
      type: 'materialize_course_closing_document',
      payload: {
        recordId: record.id,
        documentType: 'evaluation',
        templateVersion: 1,
      },
      idempotencyKey,
    }, { actorId: input.actor.uid, operation: 'course-closing:archive-evaluation' });

    const materializeFn = deps.materialize || defaultMaterializeCourseClosingDocument;
    try {
      await materializeFn(db, {
        recordId: record.id,
        documentType: 'evaluation',
        templateVersion: 1,
      });
      await completeOutboxJob(db, jobId);
      return 'ready';
    } catch {
      return 'pending';
    }
  } catch (err) {
    if (err instanceof CourseClosingRecordSourceError) {
      console.warn(`[CourseClosingArchive] Skipped evaluation archive: ${err.errorCode}`);
      return 'skipped';
    }
    throw err;
  }
}

export async function archiveTuitionNotification(
  db: DocumentStore,
  input: TuitionArchiveInput,
  deps: ArchiveOrchestrationDeps = {}
): Promise<'ready' | 'pending' | 'skipped'> {
  try {
    const resolveIdentity = deps.resolveIdentity || defaultResolveCourseClosingArchiveIdentity;
    const identity = await resolveIdentity(db, input.context, input.actor);

    const finalEval = {
      ...(input.context.finalEvaluation || {}),
      ...(input.context.finalEvaluationData || {}),
    };
    const finalExamScore = Number(finalEval.finalScore ?? finalEval.totalScore ?? 0);
    const finalExamDate = String(finalEval.date || identity.courseEndDate);

    const snapshot = buildTuitionArchiveSnapshot({
      noticeDate: input.context.noticeDate || identity.courseEndDate,
      tuitionAmount: input.tuitionAmount,
      paymentDueDate: input.paymentDueDate,
      courseStartDate: identity.courseStartDate,
      courseEndDate: identity.courseEndDate,
      finalExamDate,
      finalExamScore,
      classData: input.context.classData,
      ledgerId: input.ledgerId,
    });

    const record = await upsertTuitionRecord(db, {
      identity,
      snapshot,
      sourceNotificationId: input.sourceNotificationId,
    });

    const createJob = deps.createOutboxJob || defaultCreateOutboxJob;
    const idempotencyKey = `closing-record:${identity.courseId}:${identity.studentId}:tuition:v1`;
    const jobId = await createJob(db, {
      type: 'materialize_course_closing_document',
      payload: {
        recordId: record.id,
        documentType: 'tuition',
        templateVersion: 1,
      },
      idempotencyKey,
    }, { actorId: input.actor.uid, operation: 'course-closing:archive-tuition' });

    const materializeFn = deps.materialize || defaultMaterializeCourseClosingDocument;
    try {
      await materializeFn(db, {
        recordId: record.id,
        documentType: 'tuition',
        templateVersion: 1,
      });
      await completeOutboxJob(db, jobId);
      return 'ready';
    } catch {
      return 'pending';
    }
  } catch (err) {
    if (err instanceof CourseClosingRecordSourceError) {
      console.warn(`[CourseClosingArchive] Skipped tuition archive: ${err.errorCode}`);
      return 'skipped';
    }
    throw err;
  }
}

export async function ensureCourseClosingArchiveRepair(
  db: DocumentStore,
  input: {
    context: any;
    documentType: ClosingDocumentType;
    actor: { uid: string; role?: string; name?: string };
    ledgerId?: string;
    tuitionAmount?: number;
    paymentDueDate?: string;
  },
  deps: ArchiveOrchestrationDeps = {}
): Promise<void> {
  try {
    if (input.documentType === 'evaluation') {
      await archiveEvaluationNotification(
        db,
        {
          context: input.context,
          actor: input.actor,
        },
        deps
      );
    } else {
      const classData = input.context.classData || {};
      let ledgerData: Record<string, unknown> | undefined;
      if (input.ledgerId) {
        const ledgerDoc = await db.collection('course_fee_ledgers').doc(input.ledgerId).get();
        if (ledgerDoc.exists) {
          ledgerData = (ledgerDoc.data() || {}) as Record<string, unknown>;
        }
      }

      const amount = Number(
        input.tuitionAmount ??
          ledgerData?.amount ??
          ledgerData?.tuitionAmount ??
          classData.tuitionFee ??
          classData.fee ??
          0
      );
      const explicitDueDate = String(
        input.paymentDueDate ||
          ledgerData?.paymentDueDate ||
          ledgerData?.tuitionDueDate ||
          ledgerData?.dueDate ||
          classData.tuitionDueDate ||
          ''
      );
      const courseEndDate = String(classData.endDate || classData.courseEndDate || '');
      const dueDate =
        explicitDueDate ||
        (courseEndDate ? getNextCourseTuitionSchedule(courseEndDate, classData).dueDate : '');
      await archiveTuitionNotification(
        db,
        {
          context: input.context,
          tuitionAmount: amount,
          paymentDueDate: dueDate,
          actor: input.actor,
          ledgerId: input.ledgerId,
        },
        deps
      );
    }
  } catch (err) {
    console.warn(`[CourseClosingArchive] Archive repair failed:`, err);
  }
}

export { materializeCourseClosingDocument };
