import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { sendZaloZNSMessage } from '../../lib/zalo/zaloHelper.js';
import { formatCoursePeriodForZalo, formatDateForZalo } from '../../lib/zalo/zaloFormat.js';
import { isCurrentAcademicCourseRecord } from '../../../../shared/academic.js';
import {
  parseNumberParam,
  logZaloNotification,
  ZALO_DELIVERY_ERROR,
  awaitZaloTrackingWrite,
} from './zaloBaseHelpers.js';
import { getTuitionDueDate, getNextCourseTuitionSchedule } from './tuitionDates.js';
import { createZaloPayloadSnapshot } from './zaloTemplatePolicy.js';

export const TUITION_NOTICE_LOG_TYPE = 'tuition_notice';
export const TUITION_NOTICE_LEGACY_LOG_TYPE = 'next_course_tuition';
export const TUITION_NOTICE_LOG_TYPES = [
  TUITION_NOTICE_LEGACY_LOG_TYPE,
  TUITION_NOTICE_LOG_TYPE,
] as const;
export const TUITION_REMINDER_LOG_TYPE = 'tuition_reminder';

export type UserInfo = {
  uid: string;
  role: string;
  name: string;
  studentId?: string;
  teacherId?: string;
};

export type CanonicalStudentRecipient = {
  studentId: string;
  studentName: string;
  studentCode: string;
  classId: string;
  className: string;
  teacherId: string;
  phone: string;
  classData: Record<string, unknown>;
};

export type CourseFeeLedgerMatch = {
  id: string;
  data: Record<string, unknown>;
};

export type NextCourseTuitionNoticeResult = {
  success: boolean;
  messageId: string | undefined;
  error?: string;
  amount: number;
  paymentDueDate: string;
  templateId: string;
  alreadySent?: boolean;
  noticeCount?: number;
  ledgerId?: string;
};

export async function getCourseFeeLedgerForRecipient(
  db: DocumentStore,
  recipient: CanonicalStudentRecipient
): Promise<CourseFeeLedgerMatch | null> {
  try {
    const ledgersSnap = await db
      .collection('course_fee_ledgers')
      .where('studentId', '==', recipient.studentId)
      .where('classId', '==', recipient.classId)
      .get();
    const termStart = String(recipient.classData.startDate || '');
    const termEnd = String(recipient.classData.endDate || '');
    const matchingLedger =
      ledgersSnap.docs.find((docSnap) => {
        const ledger = docSnap.data();
        return (
          String(ledger.termStart || '') === termStart && String(ledger.termEnd || '') === termEnd
        );
      }) || ledgersSnap.docs[0];

    if (!matchingLedger) return null;
    return { id: matchingLedger.id, data: matchingLedger.data() || {} };
  } catch (err) {
    console.error('[Zalo] Failed to resolve course tuition ledger:', err);
    return null;
  }
}

export function getTuitionNoticeCount(ledger: Record<string, unknown>): number {
  return parseNumberParam(ledger.tuitionNoticeCount);
}

export function hasTuitionNoticeBeenSent(ledger: Record<string, unknown>): boolean {
  return getTuitionNoticeCount(ledger) > 0 || Boolean(ledger.tuitionNoticeLastSentAt);
}

export async function markTuitionNoticeLedgerSent(
  db: DocumentStore,
  ledger: CourseFeeLedgerMatch,
  user: { uid: string },
  userInfo: UserInfo,
  tuitionResult: Pick<NextCourseTuitionNoticeResult, 'amount' | 'messageId' | 'paymentDueDate'>,
  source: 'evaluation' | 'accounting' | 'office'
): Promise<number> {
  const nextNoticeCount = getTuitionNoticeCount(ledger.data) + 1;
  await awaitZaloTrackingWrite(
    db
      .collection('course_fee_ledgers')
      .doc(ledger.id)
      .update({
        tuitionNoticeCount: FieldValue.increment(1),
        tuitionNoticeLastSentAt: new Date().toISOString(),
        tuitionNoticeLastSentBy: user.uid,
        tuitionNoticeLastSentByName: userInfo.name,
        tuitionNoticeLastSource: source,
        tuitionNoticeLastMessageId: tuitionResult.messageId || '',
        tuitionNoticeLastAmount: tuitionResult.amount,
        tuitionNoticeLastDueDate: tuitionResult.paymentDueDate,
        updatedAt: new Date().toISOString(),
      }),
    undefined,
    `[Zalo] Failed to mark tuition ledger ${ledger.id} sent`
  );

  return nextNoticeCount;
}

export async function sendTrackedNextCourseTuitionNotice(
  db: DocumentStore,
  recipient: CanonicalStudentRecipient,
  body: Record<string, unknown>,
  courseEndDate: string,
  templateId: string,
  user: { uid: string },
  userInfo: UserInfo,
  source: 'evaluation' | 'accounting' | 'office',
  ledgerMatch?: CourseFeeLedgerMatch,
  evidence?: Record<string, unknown>,
  options: { allowAlreadySent?: boolean } = {}
): Promise<NextCourseTuitionNoticeResult> {
  const schedule = getNextCourseTuitionSchedule(courseEndDate, recipient.classData);
  const currentCourse = {
    ...recipient.classData,
    endDate: recipient.classData.endDate || schedule.previousEndDate,
  };
  const ledger = ledgerMatch || (await getCourseFeeLedgerForRecipient(db, recipient));
  if (!options.allowAlreadySent && ledger && hasTuitionNoticeBeenSent(ledger.data)) {
    return {
      success: false,
      alreadySent: true,
      messageId: undefined,
      error: 'Tuition notice already sent for this course',
      amount: parseNumberParam(ledger.data.amount),
      paymentDueDate: schedule.dueDate,
      templateId,
      noticeCount: getTuitionNoticeCount(ledger.data),
      ledgerId: ledger.id,
    };
  }

  // Cross-sync: check zalo_notifications log to catch sends done without a ledger
  const existingLogSnap = options.allowAlreadySent
    ? undefined
    : await db
        .collection('zalo_notifications')
        .where('studentId', '==', recipient.studentId)
        .where('classId', '==', recipient.classId)
        .limit(100)
        .get();
  const existingLog = existingLogSnap?.docs
    .map((docSnap) => docSnap.data() || {})
    .filter((log) => TUITION_NOTICE_LOG_TYPES.includes(log.type as any) && log.status === 'sent')
    .find((log) => isCurrentAcademicCourseRecord(log, currentCourse));
  if (!options.allowAlreadySent && existingLog) {
    return {
      success: false,
      alreadySent: true,
      messageId: undefined,
      error: 'Tuition notice already sent for this course',
      amount: parseNumberParam(existingLog.amount),
      paymentDueDate: schedule.dueDate,
      templateId,
      noticeCount: 1,
      ledgerId: ledger?.id,
    };
  }

  const tuitionResult = await sendNextCourseTuitionNotice(
    db,
    recipient,
    body,
    courseEndDate,
    templateId,
    evidence
  );

  if (tuitionResult.success && ledger) {
    const noticeCount = await markTuitionNoticeLedgerSent(
      db,
      ledger,
      user,
      userInfo,
      tuitionResult,
      source
    );
    return { ...tuitionResult, noticeCount, ledgerId: ledger.id };
  }

  return { ...tuitionResult, ledgerId: ledger?.id };
}

export async function resolveCourseTuitionFee(
  db: DocumentStore,
  recipient: CanonicalStudentRecipient
): Promise<number> {
  const classFee = parseNumberParam(recipient.classData.tuitionFee);
  if (Number.isFinite(classFee) && classFee > 0) return classFee;

  const matchingLedger = await getCourseFeeLedgerForRecipient(db, recipient);
  const ledgerFee = parseNumberParam(matchingLedger?.data.amount);
  if (Number.isFinite(ledgerFee) && ledgerFee > 0) return ledgerFee;

  return 0;
}

export type TuitionDebtReminderNoticeInput = {
  amount: number;
  semester: string;
  paymentDueDate?: string;
  tracking: {
    source: 'accounting_student_debt';
    ledgerIds: string[];
    grossOutstanding: number;
    walletBalanceApplied: number;
    netOutstanding: number;
  };
};

export async function sendTuitionReminderNotice(
  db: DocumentStore,
  recipient: CanonicalStudentRecipient,
  input: TuitionDebtReminderNoticeInput,
  templateId: string
): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  amount: number;
  paymentDueDate: string;
  templateId: string;
}> {
  const paymentDueDate = getTuitionDueDate({ paymentDueDate: input.paymentDueDate }, '', {});
  const templateData = {
    student_name: recipient.studentName,
    student_code: recipient.studentCode || '',
    amount: input.amount,
    semester: input.semester,
    due_date: paymentDueDate,
  };

  if (!templateId) {
    const error = 'ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID is not configured';
    await logZaloNotification({
      studentId: recipient.studentId,
      studentName: recipient.studentName,
      classId: recipient.classId,
      className: recipient.className,
      teacherId: recipient.teacherId,
      phone: recipient.phone,
      templateId: '',
      status: 'failed',
      zaloMessageId: '',
      errorMessage: error,
      date: paymentDueDate,
      semester: input.semester,
      type: TUITION_REMINDER_LOG_TYPE,
      amount: input.amount,
      payloadCaptured: false,
      ...input.tracking,
    });

    return {
      success: false,
      messageId: undefined,
      error,
      amount: input.amount,
      paymentDueDate,
      templateId,
    };
  }

  const result = await sendZaloZNSMessage(
    templateId,
    templateData,
    recipient.phone,
    `edutrack_fee_${recipient.studentId}_${Date.now()}`.substring(0, 48)
  );

  await logZaloNotification({
    studentId: recipient.studentId,
    studentName: recipient.studentName,
    classId: recipient.classId,
    className: recipient.className,
    teacherId: recipient.teacherId,
    phone: recipient.phone,
    templateId,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date: paymentDueDate,
    semester: input.semester,
    type: TUITION_REMINDER_LOG_TYPE,
    amount: input.amount,
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId,
      phone: recipient.phone,
      templateData,
    }),
    ...input.tracking,
  });

  return {
    success: result.success,
    messageId: result.messageId,
    error: result.success ? undefined : ZALO_DELIVERY_ERROR,
    amount: input.amount,
    paymentDueDate,
    templateId,
  };
}

export async function sendNextCourseTuitionNotice(
  db: DocumentStore,
  recipient: CanonicalStudentRecipient,
  body: Record<string, unknown>,
  courseEndDate: string,
  templateId: string,
  evidence?: Record<string, unknown>
) {
  const schedule = getNextCourseTuitionSchedule(courseEndDate, recipient.classData);
  const explicitSchoolFee =
    body.schoolFee !== undefined
      ? parseNumberParam(body.schoolFee)
      : parseNumberParam(body.tuitionAmount);
  // Next course tuition only uses class.tuitionFee, not ledger
  const classFee = parseNumberParam(recipient.classData.tuitionFee);
  const schoolFee =
    Number.isFinite(explicitSchoolFee) && explicitSchoolFee > 0
      ? explicitSchoolFee
      : Number.isFinite(classFee) && classFee > 0
        ? classFee
        : 0;
  const templateData = {
    student_name: recipient.studentName,
    student_code: recipient.studentCode || '',
    previous_end_date: schedule.previousEndDate,
    start_date: schedule.startDate,
    end_date: schedule.endDate,
    amount: Number(schoolFee) || 0,
    due_date: schedule.dueDate,
  };

  if (!templateId) {
    const error = 'ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID is not configured';
    await logZaloNotification({
      studentId: recipient.studentId,
      studentName: recipient.studentName,
      classId: recipient.classId,
      className: recipient.className,
      teacherId: recipient.teacherId,
      phone: recipient.phone,
      templateId: '',
      status: 'failed',
      zaloMessageId: '',
      errorMessage: error,
      date: schedule.dueDate,
      courseEndDate: schedule.previousEndDate,
      nextCourseStartDate: schedule.startDate,
      nextCourseEndDate: schedule.endDate,
      type: TUITION_NOTICE_LOG_TYPE,
      amount: Number(schoolFee) || 0,
      payloadCaptured: false,
      ...evidence,
    });

    return {
      success: false,
      messageId: undefined,
      error,
      amount: Number(schoolFee) || 0,
      paymentDueDate: schedule.dueDate,
      templateId,
    };
  }

  const result = await sendZaloZNSMessage(
    templateId,
    templateData,
    recipient.phone,
    `edutrack_fee_${recipient.studentId}_${Date.now()}`.substring(0, 48)
  );

  await logZaloNotification({
    studentId: recipient.studentId,
    studentName: recipient.studentName,
    classId: recipient.classId,
    className: recipient.className,
    teacherId: recipient.teacherId,
    phone: recipient.phone,
    templateId,
    status: result.success ? 'sent' : 'failed',
    zaloMessageId: result.messageId || '',
    errorMessage: result.error || '',
    ...(result.errorCode !== undefined ? { providerErrorCode: result.errorCode } : {}),
    date: schedule.dueDate,
    courseEndDate: schedule.previousEndDate,
    nextCourseStartDate: schedule.startDate,
    nextCourseEndDate: schedule.endDate,
    type: TUITION_NOTICE_LOG_TYPE,
    amount: Number(schoolFee) || 0,
    payloadCaptured: true,
    payloadSnapshot: createZaloPayloadSnapshot({
      templateId,
      phone: recipient.phone,
      templateData,
    }),
    ...evidence,
  });

  return {
    success: result.success,
    messageId: result.messageId,
    error: result.success ? undefined : ZALO_DELIVERY_ERROR,
    amount: Number(schoolFee) || 0,
    paymentDueDate: schedule.dueDate,
    templateId,
  };
}
