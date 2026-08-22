/** READ-ONLY: inspect Mai Ly's course-closing state before any production repair. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { computeCourseClosingComputation } from '../server/api/classes/helpers/courseClosing.js';

const STUDENT_ID = 'b9C4QhZ1h7qQEFp8ChId';
const CLASS_ID = 'XXTe0dcLydenBbhXkIHF';
const DATABASE_ID = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';

const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  DATABASE_ID
);

const [student, classDoc, enrollments, evaluations, ledgers] = await Promise.all([
  db.collection('students').doc(STUDENT_ID).get(),
  db.collection('classes').doc(CLASS_ID).get(),
  db.collection('student_course_enrollments').where('studentId', '==', STUDENT_ID).get(),
  db.collection('evaluations').where('studentId', '==', STUDENT_ID).get(),
  db.collection('course_fee_ledgers').where('studentId', '==', STUDENT_ID).get(),
]);

if (!classDoc.exists) throw new Error(`Class ${CLASS_ID} not found`);
const classData = classDoc.data() || {};
const courseId = String(classData.currentCourseId || '');
const notifications = courseId
  ? await db.collection('zalo_notifications').where('courseId', '==', courseId).get()
  : null;
const computation = await computeCourseClosingComputation(db, CLASS_ID);

const relevantEnrollment = enrollments.docs
  .filter((doc) => String(doc.data().classId || '') === CLASS_ID)
  .map((doc) => ({ id: doc.id, ...doc.data() }));
const relevantEvaluations = evaluations.docs
  .filter((doc) => String(doc.data().classId || '') === CLASS_ID)
  .map((doc) => ({ id: doc.id, ...doc.data() }));
const relevantLedgers = ledgers.docs
  .filter((doc) => String(doc.data().classId || '') === CLASS_ID)
  .map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      tuitionNoticeCount: data.tuitionNoticeCount,
      tuitionNoticeLastSentAt: data.tuitionNoticeLastSentAt,
      tuitionNoticeLastSentBy: data.tuitionNoticeLastSentBy,
      tuitionNoticeLastSource: data.tuitionNoticeLastSource,
      tuitionNoticeLastMessageId: data.tuitionNoticeLastMessageId,
      tuitionNoticeLastAmount: data.tuitionNoticeLastAmount,
      tuitionNoticeLastDueDate: data.tuitionNoticeLastDueDate,
    };
  });
const notificationRows = (notifications?.docs || []).map((doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    studentId: data.studentId,
    studentName: data.studentName,
    type: data.type,
    status: data.status,
    courseId: data.courseId,
    evaluationId: data.evaluationId,
    evaluationVersion: data.evaluationVersion,
    rank: data.rank,
    date: data.date,
    createdAt: data.createdAt,
    sentAt: data.sentAt,
    zaloMessageId: data.zaloMessageId,
    source: data.source,
    manuallyRecorded: data.manuallyRecorded,
    deliverySkipped: data.deliverySkipped,
    actualDeliveryStatus: data.actualDeliveryStatus,
    providerMessageId: data.providerMessageId,
    trackingId: data.trackingId,
    deliveredAt: data.deliveredAt,
  };
});

const byTypeAndStatus = notificationRows.reduce<Record<string, number>>((result, row) => {
  const key = `${String(row.type)}:${String(row.status)}`;
  result[key] = (result[key] || 0) + 1;
  return result;
}, {});

console.log(
  JSON.stringify(
    {
      student: {
        id: student.id,
        name: student.data()?.name,
        profileClassId: student.data()?.classId,
      },
      class: {
        id: classDoc.id,
        name: classData.name,
        startDate: classData.startDate,
        endDate: classData.endDate,
        currentCourseId: courseId,
        courseClosing: classData.courseClosing,
      },
      relevantEnrollment,
      relevantEvaluations,
      relevantLedgers,
      snapshot: computation.snapshot,
      fingerprints: computation.fingerprints,
      requiredStudentIds: computation.requiredStudentIds,
      maiLyNotifications: notificationRows.filter((row) => row.studentId === STUDENT_ID),
      notificationCounts: byTypeAndStatus,
      successfulExamples: notificationRows.filter((row) => row.status === 'sent').slice(0, 12),
    },
    null,
    2
  )
);
