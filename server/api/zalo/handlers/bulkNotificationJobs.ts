import { withStudentIdentityMutationLease } from '../../lib/maintenance/studentIdentityMutationLease.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import type { StaffActor } from '../../lib/auth/contextUser.js';
import { normalizeBody, withStatus } from '../../lib/http/helpers.js';
import { assertTeacherClassAccess } from '../../lib/services/classService.js';
import { getZaloConfig, sendZaloZNSMessage } from '../../lib/zalo/zaloHelper.js';
import { formatDateForZalo } from '../../lib/zalo/zaloFormat.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { chunks } from '../../read/handlers/utils.js';
import {
  assertCourseClosingClassApproved,
  assertCourseClosingSendAllowed,
  CourseClosingAlreadySentError,
  CourseClosingError,
  type CourseClosingSendContext,
} from '../../classes/helpers/courseClosing.js';
import {
  buildCanonicalEvaluationNotification,
  buildCanonicalRankNotification,
  buildCanonicalTuitionNoticeBody,
  recipientFromCourseClosingContext,
} from '../helpers/courseClosingNotificationPayloads.js';
import { logZaloNotification, markZaloSendRecord } from '../helpers/zaloBaseHelpers.js';
import { sendTrackedNextCourseTuitionNotice } from '../helpers/tuitionNotices.js';
import { createZaloPayloadSnapshot } from '../helpers/zaloTemplatePolicy.js';

type BulkType = 'evaluation' | 'rank_achievement' | 'tuition_notice';
type GuardType = 'evaluation' | 'rank' | 'tuition';

type BulkItemInput = {
  studentId: string;
  ledgerId?: string;
};

type BulkResult = {
  studentId: string;
  success: boolean;
  sent?: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  alreadySent?: boolean;
};

const ALLOWED_TYPES = new Set<BulkType>(['evaluation', 'rank_achievement', 'tuition_notice']);
const MAX_RECIPIENTS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeBulkItems(body: Record<string, unknown>): BulkItemInput[] {
  if (!Array.isArray(body.items)) return [];
  const byStudentId = new Map<string, BulkItemInput>();
  for (const value of body.items) {
    if (!isRecord(value)) continue;
    const studentId = String(value.studentId || '').trim();
    if (!studentId || byStudentId.has(studentId)) continue;
    const ledgerId = String(value.ledgerId || '').trim();
    byStudentId.set(studentId, { studentId, ...(ledgerId ? { ledgerId } : {}) });
  }
  return [...byStudentId.values()];
}

function guardTypeFor(type: BulkType): GuardType {
  if (type === 'evaluation') return 'evaluation';
  if (type === 'rank_achievement') return 'rank';
  return 'tuition';
}

function errorResult(studentId: string, err: unknown): BulkResult {
  if (err instanceof CourseClosingAlreadySentError) {
    return { studentId, success: true, alreadySent: true };
  }
  return {
    studentId,
    success: false,
    error: err instanceof Error ? err.message : String(err),
    ...(err instanceof CourseClosingError ? { errorCode: err.errorCode } : {}),
  };
}

async function sendEvaluationItem(
  db: DocumentStore,
  context: CourseClosingSendContext,
  actor: StaffActor
): Promise<BulkResult> {
  const recipient = recipientFromCourseClosingContext(context, actor.uid);
  const canonical = buildCanonicalEvaluationNotification(context);
  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return { studentId: recipient.studentId, success: false, error: 'Zalo OA is not configured' };
  }
  if (!cfg.znsEvalTemplateId) {
    return {
      studentId: recipient.studentId,
      success: false,
      error: 'Evaluation template is not configured',
    };
  }

  const dedupKey = [
    recipient.studentId,
    recipient.classId,
    context.courseId,
    context.evaluationId,
    context.evaluationVersion,
  ].join(':');
  const templateData = {
    student_name: recipient.studentName,
    student_code: recipient.studentCode,
    course_end_date: canonical.courseEndDate ? formatDateForZalo(canonical.courseEndDate) : '',
    final_grade: canonical.finalGrade,
    good: canonical.good,
    bad: canonical.bad,
  };

  const result = await sendZaloZNSMessage(
    cfg.znsEvalTemplateId,
    templateData,
    recipient.phone,
    `edutrack_eval_${recipient.studentId}_${context.courseId}`.substring(0, 48)
  );

  await logZaloNotification({
    studentId: recipient.studentId,
    studentName: recipient.studentName,
    classId: recipient.classId,
    className: recipient.className,
    teacherId: recipient.teacherId,
    phone: recipient.phone,
    templateId: cfg.znsEvalTemplateId,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date: canonical.courseEndDate || new Date().toISOString().slice(0, 10),
    type: 'evaluation_notice',
    courseId: context.courseId,
    evaluationId: context.evaluationId,
    evaluationVersion: context.evaluationVersion,
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsEvalTemplateId,
      phone: recipient.phone,
      templateData,
    }),
  });
  if (result.success) {
    await markZaloSendRecord(db, 'notify-evaluation', dedupKey);
    try {
      const { archiveEvaluationNotification } =
        await import('../../classes/records/courseClosingRecordArchive.js');
      await archiveEvaluationNotification(db, {
        context,
        actor,
        sourceNotificationId: result.messageId,
      });
    } catch (archiveErr) {
      console.error('[CourseClosingArchive] Evaluation archive failed:', archiveErr);
    }
  }

  return {
    studentId: recipient.studentId,
    success: result.success,
    sent: result.success,
    messageId: result.messageId,
    error: result.success ? undefined : result.error || 'Could not send evaluation notice',
  };
}

async function sendRankItem(
  db: DocumentStore,
  context: CourseClosingSendContext,
  actor: StaffActor
): Promise<BulkResult> {
  const recipient = recipientFromCourseClosingContext(context, actor.uid);
  const canonical = buildCanonicalRankNotification(context);
  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return { studentId: recipient.studentId, success: false, error: 'Zalo OA is not configured' };
  }
  if (!cfg.znsRankTemplateId) {
    return {
      studentId: recipient.studentId,
      success: false,
      error: 'Rank template is not configured',
    };
  }

  const dedupKey = [
    recipient.studentId,
    recipient.classId,
    context.courseId,
    context.evaluationId,
    context.evaluationVersion,
    canonical.rank,
  ].join(':');
  const templateData = {
    student_name: recipient.studentName,
    student_code: recipient.studentCode,
    rank: canonical.rankLabel,
    discount: canonical.discount,
  };

  const result = await sendZaloZNSMessage(
    cfg.znsRankTemplateId,
    templateData,
    recipient.phone,
    `edutrack_rank_${recipient.studentId}_${context.courseId}`.substring(0, 48)
  );

  await logZaloNotification({
    studentId: recipient.studentId,
    studentName: recipient.studentName,
    classId: recipient.classId,
    className: recipient.className,
    teacherId: recipient.teacherId,
    phone: recipient.phone,
    templateId: cfg.znsRankTemplateId,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date: canonical.courseEndDate || new Date().toISOString().slice(0, 10),
    type: 'rank_achievement',
    rank: canonical.rank,
    discount: canonical.discount,
    courseId: context.courseId,
    evaluationId: context.evaluationId,
    evaluationVersion: context.evaluationVersion,
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsRankTemplateId,
      phone: recipient.phone,
      templateData,
    }),
  });
  if (result.success) await markZaloSendRecord(db, 'notify-rank-achievement', dedupKey);

  return {
    studentId: recipient.studentId,
    success: result.success,
    sent: result.success,
    messageId: result.messageId,
    error: result.success ? undefined : result.error || 'Could not send rank notice',
  };
}

async function verifiedLedger(
  db: DocumentStore,
  item: BulkItemInput,
  classId: string
): Promise<{ id: string; data: Record<string, unknown> } | undefined> {
  if (!item.ledgerId) return undefined;
  const snapshot = await db.collection('course_fee_ledgers').doc(item.ledgerId).get();
  if (!snapshot.exists) throw withStatus('Ledger not found', 404);
  const data = (snapshot.data() || {}) as Record<string, unknown>;
  if (String(data.studentId || '') !== item.studentId || String(data.classId || '') !== classId) {
    throw withStatus('Ledger is outside the requested student and class', 400);
  }
  return { id: item.ledgerId, data };
}

async function sendTuitionItem(
  db: DocumentStore,
  context: CourseClosingSendContext,
  actor: StaffActor,
  item: BulkItemInput
): Promise<BulkResult> {
  const recipient = recipientFromCourseClosingContext(context, actor.uid);
  const ledger = await verifiedLedger(db, item, recipient.classId);
  const canonicalBody = buildCanonicalTuitionNoticeBody(context, ledger?.data);
  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return { studentId: recipient.studentId, success: false, error: 'Zalo OA is not configured' };
  }
  if (!cfg.znsNextCourseTuitionTemplateId) {
    return {
      studentId: recipient.studentId,
      success: false,
      error: 'Tuition template is not configured',
    };
  }

  const courseEndDate = String(context.classData.endDate || '');
  const result = await sendTrackedNextCourseTuitionNotice(
    db,
    recipient,
    canonicalBody,
    courseEndDate,
    cfg.znsNextCourseTuitionTemplateId,
    actor,
    actor,
    actor.role === 'office' ? 'office' : 'accounting',
    ledger,
    { courseId: context.courseId }
  );
  if (result.success) {
    const dedupKey = ledger
      ? `${ledger.id}:${recipient.studentId}:${recipient.classId}:${context.courseId}:next-course`
      : `${recipient.studentId}:${recipient.classId}:${context.courseId}:next-course:no-ledger`;
    await markZaloSendRecord(db, 'notify-tuition-notice', dedupKey);
    try {
      const { archiveTuitionNotification } =
        await import('../../classes/records/courseClosingRecordArchive.js');
      await archiveTuitionNotification(db, {
        context,
        tuitionAmount: result.amount,
        paymentDueDate: result.paymentDueDate,
        actor,
        sourceNotificationId: result.messageId,
        ledgerId: item.ledgerId,
      });
    } catch (archiveErr) {
      console.error('[CourseClosingArchive] Tuition archive failed:', archiveErr);
    }
  } else if (result.alreadySent) {
    const { ensureCourseClosingArchiveRepair } =
      await import('../../classes/records/courseClosingRecordArchive.js');
    await ensureCourseClosingArchiveRepair(db, {
      context,
      documentType: 'tuition',
      actor,
      ledgerId: item.ledgerId,
      tuitionAmount: result.amount,
      paymentDueDate: result.paymentDueDate,
    });
  }

  return {
    studentId: recipient.studentId,
    success: result.success || Boolean(result.alreadySent),
    sent: result.success,
    alreadySent: result.alreadySent,
    messageId: result.messageId,
    error:
      result.success || result.alreadySent
        ? undefined
        : result.error || 'Could not send tuition notice',
  };
}

async function processBulkItem(
  db: DocumentStore,
  type: BulkType,
  classId: string,
  actor: StaffActor,
  item: BulkItemInput
): Promise<BulkResult> {
  try {
    const context = await assertCourseClosingSendAllowed(db, {
      classId,
      studentId: item.studentId,
      type: guardTypeFor(type),
    });
    if (type === 'evaluation') return await sendEvaluationItem(db, context, actor);
    if (type === 'rank_achievement') return await sendRankItem(db, context, actor);
    return await sendTuitionItem(db, context, actor, item);
  } catch (err) {
    if (err instanceof CourseClosingAlreadySentError) {
      if (err.type !== 'rank') {
        const { ensureCourseClosingArchiveRepair } =
          await import('../../classes/records/courseClosingRecordArchive.js');
        await ensureCourseClosingArchiveRepair(db, {
          context: err.context,
          documentType: err.type === 'tuition' ? 'tuition' : 'evaluation',
          actor,
          ledgerId: item.ledgerId,
        });
      }
      return { studentId: item.studentId, success: true, alreadySent: true };
    }
    return errorResult(item.studentId, err);
  }
}

export async function handleBulkNotificationJob(
  req: ApiRequest,
  res: ApiResponse,
  db: DocumentStore,
  actor: StaffActor
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = normalizeBody(req.body);
  const classId = String(body.classId || '').trim();
  const type = String(body.type || '').trim() as BulkType;
  const items = normalizeBulkItems(body);

  if (!classId) return res.status(400).json({ success: false, error: 'classId is required' });
  if (!ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ success: false, error: 'type is invalid' });
  }
  if (items.length === 0) {
    return res.status(400).json({ success: false, error: 'items is required' });
  }
  if (items.length > MAX_RECIPIENTS) {
    return res.status(400).json({ success: false, error: 'items is too large' });
  }

  await assertTeacherClassAccess(db, classId, actor.uid, actor.role);
  const preflight = await assertCourseClosingClassApproved(db, classId);

  const refs = items.map((item) => db.collection('students').doc(item.studentId));
  const snapshots = await db.getAll(...refs);
  const invalidStudentIds = snapshots
    .filter(
      (snapshot) => !snapshot.exists || String((snapshot.data() || {}).classId || '') !== classId
    )
    .map((snapshot) => snapshot.id);
  if (invalidStudentIds.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'One or more students are outside class',
      invalidStudentIds,
    });
  }

  return withStudentIdentityMutationLease(
    db,
    {
      actorId: actor.uid,
      operation: `zalo_bulk_notify`,
    },
    async ({ signal }) => {
      const jobRef = db.collection('zalo_bulk_jobs').doc();
      await jobRef.set({
        type,
        classId,
        courseId: preflight.courseId,
        items,
        requestedCount: items.length,
        validCount: items.length,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: new Date().toISOString(),
        status: 'processing',
      });

      const results: BulkResult[] = [];
      for (const group of chunks(items, 10)) {
        const groupResults = await Promise.all(
          group.map(async (item) => {
            const result = await processBulkItem(db, type, classId, actor, item);
            await db.collection('zalo_bulk_job_items').add({
              jobId: jobRef.id,
              studentId: item.studentId,
              status: result.alreadySent ? 'already_sent' : result.success ? 'sent' : 'failed',
              type,
              classId,
              courseId: preflight.courseId,
              messageId: result.messageId || '',
              error: result.error || '',
              ...(result.errorCode ? { errorCode: result.errorCode } : {}),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            return result;
          })
        );
        results.push(...groupResults);
      }

      const successCount = results.filter((result) => result.success).length;
      const sentCount = results.filter((result) => result.sent).length;
      await jobRef.set(
        {
          status: successCount === results.length ? 'completed' : 'partial_failure',
          successCount,
          failureCount: results.length - successCount,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      if (sentCount > 0) {
        await touchRealtimeEvent('course-closing', { targetId: classId });
      }

      return res.status(200).json({
        success: true,
        jobId: jobRef.id,
        requestedCount: items.length,
        processedCount: results.length,
        successCount,
        failureCount: results.length - successCount,
        results,
      });
    }
  );
}
