import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { verifyAuthContext, getDb } from '../../lib/auth/verifyAuth.js';
import {
  resolveCanonicalStudentRecipient,
  getReceiptByRequest,
} from '../helpers/zaloSecurityAndAccess.js';
import { authUserFromContext, staffActorFromContext } from '../../lib/auth/contextUser.js';
import {
  getZaloConfig,
  sendZaloZNSMessage,
  checkZaloConnection,
} from '../../lib/zalo/zaloHelper.js';
import { formatCoursePeriodForZalo, formatDateForZalo } from '../../lib/zalo/zaloFormat.js';
import { normalizeBody, getString } from '../../lib/http/helpers.js';
import {
  enforceZaloSendGuard,
  markZaloSendRecord,
  logZaloNotification,
  sendZaloGatewayError,
} from '../helpers/zaloBaseHelpers.js';
import { writeAuditLog, getClientIp } from '../../lib/logging/auditLog.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';
import {
  assertCourseClosingSendAllowed,
  CourseClosingAlreadySentError,
} from '../../classes/helpers/courseClosing.js';
import {
  buildCanonicalEvaluationNotification,
  buildCanonicalRankNotification,
  recipientFromCourseClosingContext,
} from '../helpers/courseClosingNotificationPayloads.js';
import { touchRealtimeEvent } from '../../lib/realtime/events.js';
import { guardStudentIdentityRouteMutation } from '../../lib/maintenance/studentIdentityRouteGuard.js';
import { getAdminResendContext, getAdminResendLogMetadata } from '../helpers/adminResendContext.js';
import { createZaloPayloadSnapshot } from '../helpers/zaloTemplatePolicy.js';

function resolveEvaluationNotificationTerm(
  classData: Record<string, unknown>,
  requestedCourseEndDate: string
): Record<string, string> {
  const classStart = getString(classData, 'startDate');
  const classEnd = getString(classData, 'endDate');
  const courseEndDate = requestedCourseEndDate || classEnd;

  if (classEnd && courseEndDate === classEnd) {
    return { courseEndDate, termId: 'current', termStart: classStart, termEnd: classEnd };
  }

  const term = (Array.isArray(classData.terms) ? classData.terms : []).find((item) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return getString(record, 'endDate') === courseEndDate;
  });
  if (term && typeof term === 'object') {
    const record = term as Record<string, unknown>;
    return {
      courseEndDate,
      termId: getString(record, 'id'),
      termStart: getString(record, 'startDate'),
      termEnd: getString(record, 'endDate'),
    };
  }

  return courseEndDate ? { courseEndDate } : {};
}
export async function handleStatus(req: ApiRequest, res: ApiResponse) {
  const verified = await verifyAuthContext(req, res);
  if (!verified) return;

  const status = await checkZaloConnection();
  return res.status(200).json(status);
}

export async function handleNotifyAbsence(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin', 'teacher']);
  if (!verified) return;

  // After this handler's own auth gate. See `studentIdentityRouteGuard`.
  if (
    await guardStudentIdentityRouteMutation(getDb, res, {
      surface: 'messaging',
      action: 'notify-absence',
      req,
    })
  )
    return;

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const userInfo = staffActorFromContext(verified.context);
  const body = normalizeBody(req.body);
  const adminResend = getAdminResendContext(req);
  const studentId = getString(body, 'studentId');
  const classId = getString(body, 'classId');
  const date = getString(body, 'date');
  if (!studentId || !classId || !date) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' });
  }

  const recipient = await resolveCanonicalStudentRecipient(db, studentId, classId, userInfo);

  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return res.status(503).json({ success: false, error: 'Zalo OA chưa được cấu hình' });
  }
  if (!cfg.znsTemplateId) {
    return res.status(400).json({ success: false, error: 'Chưa cấu hình ZNS Template ID' });
  }

  const formattedDate = formatDateForZalo(date);
  const dedupKey = `${recipient.studentId}:${recipient.classId}:${date}`;
  if (!adminResend) {
    const guard = await enforceZaloSendGuard(db, req, res, user.uid, 'notify-absence', dedupKey);
    if (guard !== 'send') return;
  }

  const templateData = {
    student_name: recipient.studentName,
    student_id: recipient.studentCode || recipient.studentId,
    address: getString(body, 'address') || recipient.className || 'Nancy English Center',
    date: formattedDate,
  };

  const result = await sendZaloZNSMessage(
    cfg.znsTemplateId,
    templateData,
    recipient.phone,
    `edutrack_abs_${recipient.studentId}_${date}`.substring(0, 48)
  );

  await logZaloNotification({
    studentId: recipient.studentId,
    studentName: recipient.studentName,
    classId: recipient.classId,
    className: recipient.className,
    teacherId: recipient.teacherId,
    phone: recipient.phone,
    templateId: cfg.znsTemplateId,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date,
    type: 'absence',
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsTemplateId,
      phone: recipient.phone,
      templateData,
    }),
    ...getAdminResendLogMetadata(req),
  });

  if (result.success) {
    if (!adminResend) await markZaloSendRecord(db, 'notify-absence', dedupKey);
    void writeAuditLog(getDb(), {
      userId: user.uid,
      userRole: 'teacher',
      action: 'create',
      collection: 'zalo_notifications',
      documentId: result.messageId || 'unknown',
      metadata: {
        type: 'absence',
        studentId: recipient.studentId,
        studentName: recipient.studentName,
        phone: recipient.phone,
        date,
      },
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
    return res.status(200).json({ success: true, messageId: result.messageId, alreadySent: false });
  }
  return sendZaloGatewayError(res, { alreadySent: false });
}

export async function handleNotifyEvaluation(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const verified = await verifyAuthContext(req, res, ['admin', 'office']);
  if (!verified) return;

  // After this handler's own auth gate. See `studentIdentityRouteGuard`.
  if (
    await guardStudentIdentityRouteMutation(getDb, res, {
      surface: 'messaging',
      action: 'notify-evaluation',
      req,
    })
  )
    return;

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const userInfo = staffActorFromContext(verified.context);
  const body = normalizeBody(req.body);
  const adminResend = getAdminResendContext(req);
  const studentId = getString(body, 'studentId');
  const classId = getString(body, 'classId');
  if (!studentId || !classId) {
    return res.status(400).json({ success: false, error: 'Missing studentId or classId' });
  }

  let context;
  try {
    context = await assertCourseClosingSendAllowed(db, {
      classId,
      studentId,
      type: 'evaluation',
      ...(adminResend ? { allowAlreadySent: true } : {}),
    });
  } catch (err) {
    if (err instanceof CourseClosingAlreadySentError) {
      if (err.type !== 'rank') {
        const { ensureCourseClosingArchiveRepair } =
          await import('../../classes/records/courseClosingRecordArchive.js');
        await ensureCourseClosingArchiveRepair(db, {
          context: err.context,
          documentType: err.type === 'tuition' ? 'tuition' : 'evaluation',
          actor: userInfo,
        });
      }
      return res.status(200).json({ success: true, alreadySent: true });
    }
    throw err;
  }
  const recipient = recipientFromCourseClosingContext(context, user.uid);
  const canonical = buildCanonicalEvaluationNotification(context);
  const notificationTerm = resolveEvaluationNotificationTerm(context.classData, '');
  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return res.status(503).json({ success: false, error: 'Zalo OA is not configured' });
  }
  if (!cfg.znsEvalTemplateId) {
    return res.status(400).json({ success: false, error: 'Evaluation template is not configured' });
  }

  const dedupKey = [
    recipient.studentId,
    recipient.classId,
    context.courseId,
    context.evaluationId,
    context.evaluationVersion,
  ].join(':');
  if (!adminResend) {
    const guard = await enforceZaloSendGuard(db, req, res, user.uid, 'notify-evaluation', dedupKey);
    if (guard !== 'send') return;
  }
  const templateData = {
    student_name: recipient.studentName,
    student_code: recipient.studentCode,
    course_end_date: notificationTerm.courseEndDate
      ? formatDateForZalo(notificationTerm.courseEndDate)
      : formatCoursePeriodForZalo(context.classData, { fallbackToName: true }),
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
    ...notificationTerm,
    ...getAdminResendLogMetadata(req),
  });

  if (!result.success) return sendZaloGatewayError(res, { alreadySent: false });
  if (!adminResend) await markZaloSendRecord(db, 'notify-evaluation', dedupKey);
  try {
    const { archiveEvaluationNotification } =
      await import('../../classes/records/courseClosingRecordArchive.js');
    await archiveEvaluationNotification(db, {
      context,
      actor: userInfo,
      sourceNotificationId: result.messageId,
    });
  } catch (archiveErr) {
    console.error('[CourseClosingArchive] Evaluation archive failed:', archiveErr);
  }
  await touchRealtimeEvent('course-closing', { targetId: classId });
  void writeAuditLog(getDb(), {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'create',
    collection: 'zalo_notifications',
    documentId: result.messageId || 'unknown',
    metadata: {
      type: 'evaluation_notice',
      studentId: recipient.studentId,
      studentName: recipient.studentName,
      phone: recipient.phone,
      courseId: context.courseId,
      evaluationId: context.evaluationId,
      evaluationVersion: context.evaluationVersion,
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  return res.status(200).json({ success: true, messageId: result.messageId, alreadySent: false });
}

export async function handleNotifyRankAchievement(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  const verified = await verifyAuthContext(req, res, ['admin', 'office']);
  if (!verified) return;

  // After this handler's own auth gate. See `studentIdentityRouteGuard`.
  if (
    await guardStudentIdentityRouteMutation(getDb, res, {
      surface: 'messaging',
      action: 'notify-rank-achievement',
      req,
    })
  )
    return;

  const db = getDb();
  const user = authUserFromContext(verified.context);
  const userInfo = staffActorFromContext(verified.context);
  const body = normalizeBody(req.body);
  const adminResend = getAdminResendContext(req);
  const studentId = getString(body, 'studentId');
  const classId = getString(body, 'classId');
  if (!studentId || !classId) {
    return res.status(400).json({ success: false, error: 'Missing student or class' });
  }

  let context;
  try {
    context = await assertCourseClosingSendAllowed(db, {
      classId,
      studentId,
      type: 'rank',
      ...(adminResend ? { allowAlreadySent: true } : {}),
    });
  } catch (err) {
    if (err instanceof CourseClosingAlreadySentError) {
      return res.status(200).json({ success: true, alreadySent: true });
    }
    throw err;
  }
  const recipient = recipientFromCourseClosingContext(context, user.uid);
  const canonical = buildCanonicalRankNotification(context);
  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return res.status(503).json({ success: false, error: 'Zalo OA is not configured' });
  }
  if (!cfg.znsRankTemplateId) {
    return res.status(400).json({ success: false, error: 'rank template is not configured' });
  }

  const dedupKey = [
    recipient.studentId,
    recipient.classId,
    context.courseId,
    context.evaluationId,
    context.evaluationVersion,
    canonical.rank,
  ].join(':');
  if (!adminResend) {
    const guard = await enforceZaloSendGuard(
      db,
      req,
      res,
      user.uid,
      'notify-rank-achievement',
      dedupKey
    );
    if (guard !== 'send') return;
  }
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
    ...getAdminResendLogMetadata(req),
  });

  if (!result.success) return sendZaloGatewayError(res, { alreadySent: false });
  if (!adminResend) await markZaloSendRecord(db, 'notify-rank-achievement', dedupKey);
  await touchRealtimeEvent('course-closing', { targetId: classId });
  void writeAuditLog(getDb(), {
    userId: user.uid,
    userRole: userInfo.role,
    userName: userInfo.name,
    action: 'create',
    collection: 'zalo_notifications',
    documentId: result.messageId || 'unknown',
    metadata: {
      type: 'rank_achievement',
      studentId: recipient.studentId,
      studentName: recipient.studentName,
      phone: recipient.phone,
      rank: canonical.rank,
      courseId: context.courseId,
      evaluationId: context.evaluationId,
      evaluationVersion: context.evaluationVersion,
    },
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  return res.status(200).json({ success: true, messageId: result.messageId, alreadySent: false });
}

export async function handleNotifyStaffCredentials(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);

  const { phone, staffName, email, password } = req.body;
  if (!phone || !staffName || !email || !password) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return res.status(503).json({ success: false, error: 'Zalo OA not configured' });
  }
  if (!cfg.znsStaffTemplateId) {
    return res.status(400).json({ success: false, error: 'Staff template ID not configured' });
  }
  const db = getDb();
  const guard = await enforceZaloSendGuard(
    db,
    req,
    res,
    user.uid,
    'notify-staff-credentials',
    String(email).toLowerCase(),
    5 * 60 * 1000
  );
  if (guard !== 'send') return;

  const templateData = {
    name: staffName,
    user_name: email,
    pass_word: password,
  };

  const result = await sendZaloZNSMessage(
    cfg.znsStaffTemplateId,
    templateData,
    phone,
    `edutrack_staff_${Date.now()}`.substring(0, 48)
  );

  await logZaloNotification({
    studentName: staffName,
    phone,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date: new Date().toISOString().split('T')[0],
    type: 'staff-credentials',
    email,
    templateId: cfg.znsStaffTemplateId,
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsStaffTemplateId,
      phone,
      templateData,
    }),
  });

  if (result.success) {
    await markZaloSendRecord(db, 'notify-staff-credentials', String(email).toLowerCase());
    return res.status(200).json({ success: true, messageId: result.messageId });
  }
  return sendZaloGatewayError(res);
}

export async function handleNotifyPaymentConfirm(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin', 'accounting']);
  if (!verified) return;

  // After this handler's own auth gate. See `studentIdentityRouteGuard`.
  if (
    await guardStudentIdentityRouteMutation(getDb, res, {
      surface: 'messaging',
      action: 'notify-payment-confirm',
      req,
    })
  )
    return;
  const user = authUserFromContext(verified.context);

  const db = getDb();
  const body = normalizeBody(req.body);
  const adminResend = getAdminResendContext(req);
  const receipt = await getReceiptByRequest(db, body);
  const receiptData = receipt.data;
  const studentId = String(receiptData.studentId || '');
  const classId = String(receiptData.classId || '');
  if (!studentId || !classId) {
    return res.status(400).json({ success: false, error: 'Receipt is missing student or class' });
  }
  const [studentSnap, classSnap] = await Promise.all([
    db.collection('students').doc(studentId).get(),
    db.collection('classes').doc(classId).get(),
  ]);
  if (!studentSnap.exists || !classSnap.exists) {
    return res.status(404).json({ success: false, error: 'Student or class not found' });
  }
  const student = studentSnap.data() || {};
  const classData = classSnap.data() || {};
  const phone = normalizePhoneVN(String(student.contact || ''));
  const receiptNo = String(receiptData.receiptNo || '');
  const receivedDate = String(receiptData.receivedDate || new Date().toISOString().slice(0, 10));
  if (!phone || !receiptNo) {
    return res.status(400).json({ success: false, error: 'Receipt recipient data is incomplete' });
  }

  const cfg = getZaloConfig();
  if (!cfg.appId || !cfg.appSecret) {
    return res.status(503).json({ success: false, error: 'Zalo OA chưa được cấu hình' });
  }
  if (!cfg.znsPaymentTemplateId) {
    return res
      .status(400)
      .json({ success: false, error: 'Chưa cấu hình ZNS Template ID (thanh toán)' });
  }
  if (!adminResend) {
    const guard = await enforceZaloSendGuard(
      db,
      req,
      res,
      user.uid,
      'notify-payment-confirm',
      receiptNo
    );
    if (guard !== 'send') return;
  }

  const templateData = {
    ten_hoc_vien: String(student.name || ''),
    ma_hoc_vien: String(student.code || student.studentId || ''),
    ten_khoa_hoc: formatCoursePeriodForZalo(classData, { fallbackToName: true }),
    so_tien: Number(receiptData.amountReceived || 0),
    ma_giao_dich: receiptNo,
    ngay_thanh_toan: formatDateForZalo(receivedDate),
  };

  const result = await sendZaloZNSMessage(
    cfg.znsPaymentTemplateId,
    templateData,
    phone,
    `edutrack_pay_${receiptNo}`.substring(0, 48)
  );

  await logZaloNotification({
    studentId,
    studentName: String(student.name || ''),
    classId,
    className: String(classData.name || ''),
    phone,
    templateId: cfg.znsPaymentTemplateId,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date: receivedDate,
    type: 'payment',
    receiptNo,
    amount: Number(receiptData.amountReceived || 0),
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsPaymentTemplateId,
      phone,
      templateData,
    }),
    ...getAdminResendLogMetadata(req),
  });

  if (result.success) {
    if (!adminResend) await markZaloSendRecord(db, 'notify-payment-confirm', receiptNo);
    return res.status(200).json({ success: true, messageId: result.messageId });
  }
  return sendZaloGatewayError(res);
}

export async function handleTest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const verified = await verifyAuthContext(req, res, ['admin']);
  if (!verified) return;
  const user = authUserFromContext(verified.context);

  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Thiếu số điện thoại' });

  const cfg = getZaloConfig();
  if (!cfg.znsTemplateId)
    return res.status(400).json({ success: false, error: 'Chưa cấu hình ZNS Template ID' });

  const templateData = {
    student_name: 'Học sinh Test',
    student_id: 'HS240001',
    address: 'Nancy English Center',
    date: formatDateForZalo(new Date()),
  };

  const result = await sendZaloZNSMessage(
    cfg.znsTemplateId,
    templateData,
    phone,
    `test_${Date.now()}`
  );

  await logZaloNotification({
    studentName: 'Học sinh Test',
    phone,
    templateId: cfg.znsTemplateId,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date: new Date().toISOString().slice(0, 10),
    type: 'test',
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId: cfg.znsTemplateId,
      phone,
      templateData,
    }),
    ...getAdminResendLogMetadata(req),
  });

  if (result.success) {
    return res.status(200).json({ success: true, messageId: result.messageId });
  }
  return sendZaloGatewayError(res);
}
