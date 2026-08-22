/**
 * One-off, idempotent production repair for NGUYEN LUONG MAI LY's G6 course closing.
 *
 * This intentionally does NOT call Zalo. It records explicit manual-completion
 * evidence so the course can close after the student's canonical profile moved
 * to a new class before the old course-closing send finished.
 */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { FieldValue, getDocumentStore } from '@/server/db/documentStore.js';
import {
  computeCourseClosingComputation,
  evaluationVersion,
} from '../server/api/classes/helpers/courseClosing.js';
import { getNextCourseTuitionSchedule } from '../server/api/zalo/helpers/tuitionDates.js';
import {
  getEvaluationRankDiscount,
  normalizeEvaluationRank,
} from '../shared/evaluationRank.js';
import { normalizePhoneVN } from '../shared/phone.js';

const STUDENT_ID = 'b9C4QhZ1h7qQEFp8ChId';
const STUDENT_CODE = 'HS260587';
const CLASS_ID = 'XXTe0dcLydenBbhXkIHF';
const CLASS_NAME = 'G6 - Quỳnh T7-CN 17H30';
const COURSE_ID = 'b043105c-565c-4d05-b94f-04d2f4565a02';
const EVALUATION_ID = 'ekTTFZXfOiERStB9G1VQ';
const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const REPAIR_SOURCE = 'manual_course_closing_repair';
const REPAIR_REASON =
  'Canonical student profile already moved to the next class; user requested completion without duplicate Zalo delivery after the old-class send guard returned Student not found in class.';

const apply = process.argv.includes('--apply');
const confirmations = new Set(process.argv.slice(2));
if (
  apply &&
  (!confirmations.has(`--confirm-student=${STUDENT_CODE}`) ||
    !confirmations.has(`--confirm-class=${CLASS_ID}`) ||
    !confirmations.has(`--confirm-course=${COURSE_ID}`))
) {
  throw new Error('Apply requires exact student, class, and course confirmations.');
}

const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  DATABASE_ID
);

const [studentDoc, classDoc, evaluationDoc, enrollments, ledgers, notificationQuery] =
  await Promise.all([
    db.collection('students').doc(STUDENT_ID).get(),
    db.collection('classes').doc(CLASS_ID).get(),
    db.collection('evaluations').doc(EVALUATION_ID).get(),
    db.collection('student_course_enrollments').where('studentId', '==', STUDENT_ID).get(),
    db.collection('course_fee_ledgers').where('studentId', '==', STUDENT_ID).get(),
    db.collection('zalo_notifications').where('courseId', '==', COURSE_ID).get(),
  ]);

if (!studentDoc.exists || !classDoc.exists || !evaluationDoc.exists) {
  throw new Error('Expected student, class, or evaluation document is missing.');
}
const student = studentDoc.data() || {};
const classData = classDoc.data() || {};
const evaluation = evaluationDoc.data() || {};
if (String(student.studentId || '') !== STUDENT_CODE) throw new Error('Student code mismatch.');
if (String(classData.name || '') !== CLASS_NAME) throw new Error('Class name mismatch.');
if (String(classData.currentCourseId || '') !== COURSE_ID) throw new Error('Course ID mismatch.');
if (String(evaluation.studentId || '') !== STUDENT_ID) throw new Error('Evaluation student mismatch.');
if (String(evaluation.classId || '') !== CLASS_ID) throw new Error('Evaluation class mismatch.');
if (String(evaluation.evaluationType || '') !== 'final') throw new Error('Evaluation is not final.');
if (String(evaluation.termStart || '') !== String(classData.startDate || '')) {
  throw new Error('Evaluation term start does not match the class.');
}
if (String(evaluation.termEnd || '') !== String(classData.endDate || '')) {
  throw new Error('Evaluation term end does not match the class.');
}

const enrollment = enrollments.docs.find((doc) => {
  const data = doc.data();
  return (
    String(data.classId || '') === CLASS_ID &&
    String(data.termStart || '') === String(classData.startDate || '')
  );
});
if (!enrollment) throw new Error('Expected outgoing-course enrollment is missing.');
if (!['trial', 'active', 'on_leave', 'completed'].includes(String(enrollment.data().status || ''))) {
  throw new Error(`Unexpected enrollment status: ${String(enrollment.data().status || '')}`);
}

const ledger = ledgers.docs.find((doc) => {
  const data = doc.data();
  return (
    String(data.classId || '') === CLASS_ID &&
    String(data.termStart || '') === String(classData.startDate || '')
  );
});
if (!ledger) throw new Error('Expected outgoing-course tuition ledger is missing.');

const before = await computeCourseClosingComputation(db, CLASS_ID);
if (!before.snapshot.approvalValid) throw new Error('Course-closing approval is not valid.');
if (!before.requiredStudentIds.includes(STUDENT_ID)) {
  throw new Error('Mai Ly is not in the required outgoing-course roster.');
}
for (const pending of [
  before.snapshot.pendingEvaluationStudentIds,
  before.snapshot.pendingRankStudentIds,
  before.snapshot.pendingTuitionStudentIds,
]) {
  const unexpected = pending.filter((studentId) => studentId !== STUDENT_ID);
  if (unexpected.length > 0) {
    throw new Error(`Refusing repair because other students are still pending: ${unexpected.join(', ')}`);
  }
}

const version = evaluationVersion(evaluationDoc as never);
const rank = normalizeEvaluationRank(evaluation.rank);
if (!rank) throw new Error('Mai Ly no longer has an eligible rank.');
const now = new Date().toISOString();
const phone = normalizePhoneVN(String(student.contact || ''));
const schedule = getNextCourseTuitionSchedule(String(classData.endDate || ''), classData);
const notifications: Array<Record<string, any>> = notificationQuery.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
const successful = notifications.filter(
  (row) => row.status === 'sent' && row.studentId === STUDENT_ID
);
const evidenceMatches = {
  evaluation: successful.some(
    (row) =>
      ['evaluation', 'evaluation_notice'].includes(String(row.type || '')) &&
      row.evaluationId === EVALUATION_ID &&
      row.evaluationVersion === version
  ),
  rank: successful.some(
    (row) =>
      row.type === 'rank_achievement' &&
      row.evaluationId === EVALUATION_ID &&
      row.evaluationVersion === version
  ),
  tuition: successful.some((row) =>
    ['tuition_notice', 'next_course_tuition'].includes(String(row.type || ''))
  ),
};

const common = {
  studentId: STUDENT_ID,
  studentName: String(student.name || ''),
  studentCode: STUDENT_CODE,
  classId: CLASS_ID,
  className: CLASS_NAME,
  teacherId: String(classData.teacherId || evaluation.teacherId || ''),
  phone,
  status: 'sent',
  errorMessage: '',
  courseId: COURSE_ID,
  source: REPAIR_SOURCE,
  manuallyRecorded: true,
  deliverySkipped: true,
  manualReason: REPAIR_REASON,
  payloadCaptured: false,
  createdAt: now,
  completedAt: now,
  sentAt: now,
};
const templateId = (type: string) =>
  String(
    notifications.find((row) => row.type === type && row.status === 'sent')?.templateId || ''
  );
const docId = (type: string) => `manual_${COURSE_ID}_${STUDENT_ID}_${type}`;
const planned = [
  ...(!evidenceMatches.evaluation
    ? [
        {
          id: docId('evaluation'),
          data: {
            ...common,
            type: 'evaluation_notice',
            templateId: templateId('evaluation_notice'),
            zaloMessageId: docId('evaluation'),
            date: String(classData.endDate || ''),
            evaluationId: EVALUATION_ID,
            evaluationVersion: version,
          },
        },
      ]
    : []),
  ...(!evidenceMatches.rank
    ? [
        {
          id: docId('rank'),
          data: {
            ...common,
            type: 'rank_achievement',
            templateId: templateId('rank_achievement'),
            zaloMessageId: docId('rank'),
            date: String(classData.endDate || ''),
            evaluationId: EVALUATION_ID,
            evaluationVersion: version,
            rank,
            discount: getEvaluationRankDiscount(rank),
          },
        },
      ]
    : []),
  ...(!evidenceMatches.tuition
    ? [
        {
          id: docId('tuition'),
          data: {
            ...common,
            type: 'tuition_notice',
            templateId: templateId('tuition_notice'),
            zaloMessageId: docId('tuition'),
            date: schedule.dueDate,
            courseEndDate: schedule.previousEndDate,
            nextCourseStartDate: schedule.startDate,
            nextCourseEndDate: schedule.endDate,
            amount: Number(classData.tuitionFee || ledger.data().amount || 0),
          },
        },
      ]
    : []),
];

const summary = {
  mode: apply ? 'apply' : 'dry-run',
  target: {
    studentId: STUDENT_ID,
    studentCode: STUDENT_CODE,
    classId: CLASS_ID,
    courseId: COURSE_ID,
    evaluationId: EVALUATION_ID,
    evaluationVersion: version,
    profileClassId: String(student.classId || ''),
    outgoingEnrollmentId: enrollment.id,
    ledgerId: ledger.id,
  },
  before: before.snapshot,
  existingEvidence: evidenceMatches,
  plannedNotificationTypes: planned.map((row) => row.data.type),
  zaloDeliveryWillOccur: false,
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (planned.length > 0) {
  const batch = db.batch();
  for (const row of planned) {
    batch.create(db.collection('zalo_notifications').doc(row.id), row.data);
  }
  if (!evidenceMatches.tuition) {
    batch.update(ledger.ref, {
      tuitionNoticeCount: FieldValue.increment(1),
      tuitionNoticeLastSentAt: now,
      tuitionNoticeLastSentBy: REPAIR_SOURCE,
      tuitionNoticeLastSentByName: REPAIR_SOURCE,
      tuitionNoticeLastSource: 'office',
      tuitionNoticeLastMessageId: docId('tuition'),
      tuitionNoticeLastAmount: Number(classData.tuitionFee || ledger.data().amount || 0),
      tuitionNoticeLastDueDate: schedule.dueDate,
      updatedAt: now,
    });
  }
  batch.create(db.collection('audit_logs').doc(docId('audit')), {
    userId: REPAIR_SOURCE,
    userRole: 'system',
    userName: REPAIR_SOURCE,
    action: 'create',
    collection: 'zalo_notifications',
    documentId: planned.map((row) => row.id).join(','),
    metadata: {
      action: REPAIR_SOURCE,
      reason: REPAIR_REASON,
      studentId: STUDENT_ID,
      studentCode: STUDENT_CODE,
      classId: CLASS_ID,
      courseId: COURSE_ID,
      evaluationId: EVALUATION_ID,
      evaluationVersion: version,
      notificationTypes: planned.map((row) => row.data.type),
      deliverySkipped: true,
    },
    createdAt: now,
    timestamp: now,
  });
  await batch.commit();
}

const after = await computeCourseClosingComputation(db, CLASS_ID);
console.log(
  JSON.stringify(
    {
      ...summary,
      writtenNotificationIds: planned.map((row) => row.id),
      after: after.snapshot,
    },
    null,
    2
  )
);
