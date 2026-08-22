import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { createHash } from 'node:crypto';
import { FieldValue } from '@/server/db/documentStore.js';
import { verifyAuthContext, getDb } from '../../lib/auth/verifyAuth.js';
import { authUserFromContext, staffActorFromContext } from '../../lib/auth/contextUser.js';
import { resolveCanonicalStudentRecipient } from '../helpers/zaloSecurityAndAccess.js';
import { getZaloConfig } from '../../lib/zalo/zaloHelper.js';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import {
  buildStudentTuitionDebtSnapshot,
  type StudentTuitionDebtLedger,
} from '../helpers/studentTuitionDebt.js';
import {
  enforceZaloSendGuard,
  markZaloSendRecord,
  sendZaloGatewayError,
} from '../helpers/zaloBaseHelpers.js';
import {
  sendTuitionReminderNotice,
  sendTrackedNextCourseTuitionNotice,
  hasTuitionNoticeBeenSent,
  getTuitionNoticeCount,
  TUITION_NOTICE_LOG_TYPE,
  TUITION_NOTICE_LOG_TYPES,
  TUITION_REMINDER_LOG_TYPE,
} from '../helpers/tuitionNotices.js';
import { writeOptionalAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import {
  assertCourseClosingSendAllowed,
  CourseClosingAlreadySentError,
} from '../../classes/helpers/courseClosing.js';
import {
  buildCanonicalTuitionNoticeBody,
  recipientFromCourseClosingContext,
} from '../helpers/courseClosingNotificationPayloads.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { getAdminResendContext, getAdminResendLogMetadata } from '../helpers/adminResendContext.js';

export async function handleNotifyTuitionReminder(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin', 'accounting']);
  if (!verified) return;

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const userInfo = staffActorFromContext(verified.context);
  const body = normalizeBody(req.body);
  const adminResend = getAdminResendContext(req);

  const requestedStudentId = getString(body, 'studentId');
  const requestedLedgerId = getString(body, 'ledgerId');
  if (!requestedStudentId && !requestedLedgerId) {
    return res.status(400).json({
      success: false,
      error: 'Missing studentId or ledgerId',
    });
  }

  let studentId = requestedStudentId;
  if (!studentId) {
    const legacyLedgerSnap = await db.collection('course_fee_ledgers').doc(requestedLedgerId).get();
    if (!legacyLedgerSnap.exists) {
      return res.status(404).json({ success: false, error: 'Ledger not found' });
    }
    const legacyLedger = legacyLedgerSnap.data() || {};
    studentId = String(legacyLedger.studentId || '');
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Ledger is missing student or class' });
    }
  }

  const [studentSnap, ledgersSnap] = await Promise.all([
    db.collection('students').doc(studentId).get(),
    db.collection('course_fee_ledgers').where('studentId', '==', studentId).get(),
  ]);
  if (!studentSnap.exists) {
    return res.status(404).json({
      success: false,
      errorCode: 'student_not_found',
      error: 'Student not found',
    });
  }

  const studentData = studentSnap.data() || {};
  const ledgers: StudentTuitionDebtLedger[] = ledgersSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return { ...data, id: docSnap.id } as StudentTuitionDebtLedger;
  });

  const snapshot = buildStudentTuitionDebtSnapshot({
    ledgers,
    walletBalance: studentData.walletBalance,
  });

  const recipientClassId = String(studentData.classId || '') || snapshot.debts[0].classId;
  const recipient = await resolveCanonicalStudentRecipient(
    db,
    studentId,
    recipientClassId,
    userInfo,
    {
      allowAccounting: true,
      allowMissingStudentClass: !String(studentData.classId || ''),
    }
  );

  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return res.status(503).json({ success: false, error: 'Zalo OA chưa được cấu hình' });
  }
  if (!cfg.znsTuitionNoticeTemplateId) {
    return res.status(503).json({
      success: false,
      errorCode: 'tuition_template_not_configured',
      error: 'ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID is not configured',
    });
  }

  const dedupMaterial = JSON.stringify({
    studentId,
    netOutstanding: snapshot.netOutstanding,
    ledgerIds: snapshot.ledgerIds,
  });
  const dedupKey = createHash('sha256').update(dedupMaterial).digest('hex');

  if (!adminResend) {
    const guard = await enforceZaloSendGuard(
      db,
      req,
      res,
      user.uid,
      'notify-tuition-reminder',
      dedupKey
    );
    if (guard !== 'send') return;
  }

  const tuitionResult = await sendTuitionReminderNotice(
    db,
    recipient,
    {
      amount: snapshot.netOutstanding,
      semester: snapshot.semester,
      paymentDueDate: getString(body, 'paymentDueDate'),
      tracking: {
        source: 'accounting_student_debt',
        ledgerIds: snapshot.ledgerIds,
        grossOutstanding: snapshot.grossOutstanding,
        walletBalanceApplied: snapshot.walletBalanceApplied,
        netOutstanding: snapshot.netOutstanding,
        ...getAdminResendLogMetadata(req),
      },
    },
    cfg.znsTuitionNoticeTemplateId
  );

  if (tuitionResult.success) {
    if (!adminResend) await markZaloSendRecord(db, 'notify-tuition-reminder', dedupKey);

    const now = new Date().toISOString();
    const trackingResults = await Promise.allSettled([
      ...snapshot.debts.map((debt) =>
        db
          .collection('course_fee_ledgers')
          .doc(debt.ledgerId)
          .update({
            tuitionReminderCount: FieldValue.increment(1),
            tuitionReminderLastSentAt: now,
            tuitionReminderLastSentBy: user.uid,
            tuitionReminderLastSentByName: userInfo.name,
            tuitionReminderLastAmount: snapshot.netOutstanding,
            tuitionReminderLastDueDate: tuitionResult.paymentDueDate,
            tuitionReminderLastSemester: snapshot.semester,
            updatedAt: now,
          })
      ),
      touchRealtimeEvent('accounting-student-finance'),
    ]);
    for (const result of trackingResults) {
      if (result.status === 'rejected') {
        console.error('[Zalo] Failed to record tuition reminder tracking update:', result.reason);
      }
    }

    const response = res.status(200).json({
      success: true,
      messageId: tuitionResult.messageId,
      tuitionAmount: tuitionResult.amount,
      tuitionDueDate: tuitionResult.paymentDueDate,
      tuitionReminderCount: snapshot.nextReminderCount,
      semester: snapshot.semester,
      ledgerIds: snapshot.ledgerIds,
    });
    writeOptionalAuditLog(db, {
      userId: user.uid,
      userRole: userInfo.role,
      userName: userInfo.name,
      action: 'create',
      collection: 'zalo_notifications',
      documentId: tuitionResult.messageId || studentId,
      metadata: {
        type: TUITION_REMINDER_LOG_TYPE,
        source: 'accounting_student_debt',
        studentId,
        ledgerIds: snapshot.ledgerIds,
        grossOutstanding: snapshot.grossOutstanding,
        walletBalanceApplied: snapshot.walletBalanceApplied,
        netOutstanding: snapshot.netOutstanding,
        semester: snapshot.semester,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
    return response;
  }

  return sendZaloGatewayError(res, {
    tuitionAmount: tuitionResult.amount,
    tuitionDueDate: tuitionResult.paymentDueDate,
  });
}

export async function handleNotifyTuitionNotice(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const verified = await verifyAuthContext(req, res, ['admin', 'accounting', 'office']);
  if (!verified) return;

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const userInfo = staffActorFromContext(verified.context);
  const body = normalizeBody(req.body);
  const adminResend = getAdminResendContext(req);
  const ledgerId = getString(body, 'ledgerId');
  let studentId = getString(body, 'studentId');
  let classId = getString(body, 'classId');
  let ledger: Record<string, unknown> | undefined;
  if (ledgerId) {
    const ledgerSnap = await db.collection('course_fee_ledgers').doc(ledgerId).get();
    if (!ledgerSnap.exists) {
      return res.status(404).json({ success: false, error: 'Ledger not found' });
    }
    ledger = ledgerSnap.data() || {};
    studentId = String(ledger.studentId || '');
    classId = String(ledger.classId || '');
  }
  if (!studentId || !classId) {
    return res.status(400).json({ success: false, error: 'Missing studentId or classId' });
  }

  let context;
  try {
    context = await assertCourseClosingSendAllowed(db, {
      classId,
      studentId,
      type: 'tuition',
      ...(adminResend ? { allowAlreadySent: true } : {}),
    });
  } catch (err) {
    if (err instanceof CourseClosingAlreadySentError) {
      const { ensureCourseClosingArchiveRepair } =
        await import('../../classes/records/courseClosingRecordArchive.js');
      await ensureCourseClosingArchiveRepair(db, {
        context: err.context,
        documentType: 'tuition',
        actor: userInfo,
        ledgerId,
      });
      return res.status(409).json({
        success: false,
        alreadySent: true,
        error: err.message,
        tuitionNoticeCount: ledger ? getTuitionNoticeCount(ledger) || 1 : 1,
      });
    }
    throw err;
  }
  if (
    ledger &&
    (String(ledger.studentId || '') !== studentId || String(ledger.classId || '') !== classId)
  ) {
    return res.status(400).json({ success: false, error: 'Ledger ownership mismatch' });
  }
  if (!adminResend && ledger && hasTuitionNoticeBeenSent(ledger)) {
    const { ensureCourseClosingArchiveRepair } =
      await import('../../classes/records/courseClosingRecordArchive.js');
    await ensureCourseClosingArchiveRepair(db, {
      context,
      documentType: 'tuition',
      actor: userInfo,
      ledgerId,
    });
    return res.status(409).json({
      success: false,
      alreadySent: true,
      error: 'Tuition notice already sent for this course',
      tuitionNoticeCount: getTuitionNoticeCount(ledger),
    });
  }

  const recipient = recipientFromCourseClosingContext(context, user.uid);
  const canonicalBody = buildCanonicalTuitionNoticeBody(context, ledger);
  const courseEndDate = String(context.classData.endDate || '');
  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return res.status(503).json({ success: false, error: 'Zalo OA is not configured' });
  }
  const dedupKey = [ledgerId || 'no-ledger', studentId, classId, context.courseId].join(':');
  if (!adminResend) {
    const guard = await enforceZaloSendGuard(
      db,
      req,
      res,
      user.uid,
      'notify-tuition-notice',
      dedupKey
    );
    if (guard !== 'send') return;
  }
  const tuitionResult = await sendTrackedNextCourseTuitionNotice(
    db,
    recipient,
    canonicalBody,
    courseEndDate,
    cfg.znsNextCourseTuitionTemplateId,
    user,
    userInfo,
    userInfo.role === 'office' ? 'office' : 'accounting',
    ledger && ledgerId ? { id: ledgerId, data: ledger } : undefined,
    { courseId: context.courseId, ...getAdminResendLogMetadata(req) },
    { allowAlreadySent: Boolean(adminResend) }
  );

  if (tuitionResult.success) {
    if (!adminResend) await markZaloSendRecord(db, 'notify-tuition-notice', dedupKey);
    try {
      const { archiveTuitionNotification } =
        await import('../../classes/records/courseClosingRecordArchive.js');
      await archiveTuitionNotification(db, {
        context,
        tuitionAmount: tuitionResult.amount,
        paymentDueDate: tuitionResult.paymentDueDate,
        actor: userInfo,
        sourceNotificationId: tuitionResult.messageId,
        ledgerId,
      });
    } catch (archiveErr) {
      console.error('[CourseClosingArchive] Tuition archive failed:', archiveErr);
    }
    await touchRealtimeEvent('course-closing', { targetId: classId });
    const response = res.status(200).json({
      success: true,
      messageId: tuitionResult.messageId,
      tuitionAmount: tuitionResult.amount,
      tuitionDueDate: tuitionResult.paymentDueDate,
      tuitionNoticeCount: tuitionResult.noticeCount || 1,
    });
    writeOptionalAuditLog(db, {
      userId: user.uid,
      userRole: userInfo.role,
      userName: userInfo.name,
      action: 'create',
      collection: 'zalo_notifications',
      documentId: tuitionResult.messageId || ledgerId || studentId,
      metadata: {
        type: TUITION_NOTICE_LOG_TYPE,
        source: userInfo.role === 'office' ? 'office_academic_notice' : 'accounting_ledger_notice',
        ...(ledgerId ? { ledgerId } : {}),
        studentId,
        studentName: recipient.studentName,
        phone: recipient.phone,
        tuitionNoticeTemplateId: tuitionResult.templateId,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
    return response;
  }

  if (tuitionResult.alreadySent) {
    const { ensureCourseClosingArchiveRepair } =
      await import('../../classes/records/courseClosingRecordArchive.js');
    await ensureCourseClosingArchiveRepair(db, {
      context,
      documentType: 'tuition',
      actor: userInfo,
      ledgerId,
      tuitionAmount: tuitionResult.amount,
      paymentDueDate: tuitionResult.paymentDueDate,
    });
    return res.status(409).json({
      success: false,
      alreadySent: true,
      error: 'Tuition notice already sent for this course',
      tuitionAmount: tuitionResult.amount,
      tuitionDueDate: tuitionResult.paymentDueDate,
      tuitionNoticeCount: tuitionResult.noticeCount || 1,
    });
  }

  return sendZaloGatewayError(res, {
    tuitionAmount: tuitionResult.amount,
    tuitionDueDate: tuitionResult.paymentDueDate,
  });
}
