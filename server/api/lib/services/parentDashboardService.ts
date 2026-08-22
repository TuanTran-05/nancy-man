import type { DocumentStore, QuerySnapshot } from '@/server/db/documentStore.js';
import type { UserContext } from '../auth/authz.js';
import { projectStudent } from '../student/studentProjection.js';
import { canStudentAccessAssignment } from '../../../../shared/assignmentDelivery.js';
import { resolveCanonicalStudentId } from '../student/studentIdentityResolver.js';

export interface ParentDashboardPayload {
  student: Record<string, unknown>;
  classInfo: Record<string, unknown> | null;
  assignments: Record<string, unknown>[];
  attendance: Record<string, unknown>[];
  evaluations: Record<string, unknown>[];
  submissions: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  tuition: {
    ledgers: Record<string, unknown>[];
    receipts: Record<string, unknown>[];
  };
}

type DashboardDoc = {
  id: string;
  data(): Record<string, unknown> | undefined;
};

function pickString(data: Record<string, unknown>, key: string) {
  return typeof data[key] === 'string' && data[key] ? { [key]: String(data[key]) } : {};
}

function pickValue(data: Record<string, unknown>, key: string) {
  return data[key] !== undefined ? { [key]: data[key] } : {};
}

function mapDocs(
  snap: Pick<QuerySnapshot, 'docs'>,
  project: (doc: DashboardDoc) => Record<string, unknown>
): Record<string, unknown>[] {
  return snap.docs
    .filter((doc) => doc.data()?.isDeleted !== true && doc.data()?.isVoided !== true)
    .map((doc) => project(doc as DashboardDoc));
}

function projectClassDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'name'),
    ...pickString(data, 'schedule'),
    ...pickValue(data, 'daysOfWeek'),
    ...pickString(data, 'description'),
    ...pickString(data, 'startDate'),
    ...pickString(data, 'endDate'),
    ...pickString(data, 'startTime'),
    ...pickString(data, 'room'),
    ...pickString(data, 'teacherId'),
    ...pickString(data, 'status'),
    ...pickValue(data, 'grade'),
    ...pickValue(data, 'terms'),
  };
}

function projectAssignmentDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'classId'),
    ...pickString(data, 'title'),
    ...pickString(data, 'description'),
    ...pickString(data, 'type'),
    ...pickString(data, 'dueDate'),
    ...pickString(data, 'status'),
    ...pickValue(data, 'maxScore'),
    ...pickValue(data, 'createdAt'),
    ...pickValue(data, 'updatedAt'),
  };
}

function projectSubmissionDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'assignmentId'),
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'status'),
    ...pickValue(data, 'score'),
    ...pickValue(data, 'grade'),
    ...pickValue(data, 'submittedAt'),
    ...pickValue(data, 'gradedAt'),
    ...pickString(data, 'feedback'),
  };
}

function projectAttendanceDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'status'),
    ...pickString(data, 'date'),
    ...pickString(data, 'sessionId'),
    ...pickString(data, 'note'),
  };
}

function projectEvaluationDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'title'),
    ...pickString(data, 'type'),
    ...pickString(data, 'evaluationType'),
    ...pickValue(data, 'score'),
    ...pickValue(data, 'scores'),
    ...pickString(data, 'date'),
    ...pickString(data, 'term'),
    ...pickString(data, 'termId'),
    ...pickString(data, 'termStart'),
    ...pickString(data, 'termEnd'),
    ...pickValue(data, 'maxScore'),
    ...pickValue(data, 'weight'),
    ...pickValue(data, 'finalScore'),
    ...pickValue(data, 'totalScore'),
    ...pickValue(data, 'positivePoints'),
    ...pickValue(data, 'improvementPoints'),
    ...pickValue(data, 'aiFeedback'),
  };
}

function projectNotificationDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'title'),
    ...pickString(data, 'message'),
    ...pickString(data, 'type'),
    ...pickValue(data, 'createdAt'),
    ...pickValue(data, 'readAt'),
    ...pickString(data, 'status'),
    ...pickValue(data, 'isRead'),
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
  };
}

function projectLedgerDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickValue(data, 'amount'),
    ...pickValue(data, 'balance'),
    ...pickValue(data, 'debit'),
    ...pickValue(data, 'credit'),
    ...pickString(data, 'status'),
    ...pickString(data, 'description'),
    ...pickValue(data, 'date'),
    ...pickValue(data, 'dueDate'),
    ...pickValue(data, 'paidTotal'),
    ...pickValue(data, 'discountTotal'),
    ...pickString(data, 'termStart'),
    ...pickString(data, 'termEnd'),
  };
}

export function projectReceiptDoc(doc: DashboardDoc): Record<string, unknown> {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...pickString(data, 'studentId'),
    ...pickString(data, 'classId'),
    ...pickString(data, 'ledgerId'),
    ...pickString(data, 'receiptNo'),
    ...pickValue(data, 'amountReceived'),
    ...pickString(data, 'flowVersion'),
    ...pickValue(data, 'classIds'),
    ...pickValue(data, 'allocations'),
    ...pickValue(data, 'walletBalanceBefore'),
    ...pickValue(data, 'walletBalanceAfter'),
    ...pickString(data, 'status'),
    ...pickValue(data, 'issuedAt'),
    ...pickValue(data, 'paidAt'),
    ...pickString(data, 'receivedDate'),
    ...pickValue(data, 'createdAt'),
    ...pickString(data, 'description'),
  };
}

export async function getParentDashboardPayload(
  db: DocumentStore,
  ctx: UserContext,
  limit = 50
): Promise<ParentDashboardPayload> {
  if (ctx.role !== 'parent' && ctx.role !== 'student') {
    throw new Error('Forbidden');
  }
  if (!ctx.studentId) {
    throw new Error('Missing student context');
  }

  // Resolved before anything is loaded. A linked account stores the profile id
  // it was created against; once that profile is merged away, every query
  // below returns nothing and the parent sees a dashboard that looks like a
  // child with no attendance, no evaluations, and no money owed.
  //
  // An unresolvable link keeps the stored id: a broken pointer is not a reason
  // to lock a family out, and what was written under that id is still the best
  // answer available.
  const canonicalStudentId = await resolveCanonicalStudentId(db, ctx.studentId)
    .then((resolution) => resolution.canonicalProfileId)
    .catch(() => ctx.studentId as string);
  ctx = { ...ctx, studentId: canonicalStudentId };

  const studentSnap = await db.collection('students').doc(canonicalStudentId).get();
  if (!studentSnap.exists) {
    throw new Error('Student not found');
  }

  const student = projectStudent({ id: studentSnap.id, ...(studentSnap.data() || {}) }, 'session');
  const classId = String(student.classId || ctx.classId || '');
  const emptyDocs = { docs: [] } as Pick<QuerySnapshot, 'docs'>;

  const [
    classSnap,
    assignmentsSnap,
    attendanceSnap,
    evaluationsSnap,
    submissionsSnap,
    notificationsSnap,
    ledgersSnap,
    receiptsSnap,
  ] = await Promise.all([
    classId ? db.collection('classes').doc(classId).get() : Promise.resolve(null),
    classId
      ? db.collection('assignments').where('classId', '==', classId).limit(limit).get()
      : Promise.resolve(emptyDocs),
    db.collection('attendance').where('studentId', '==', ctx.studentId).limit(limit).get(),
    db.collection('evaluations').where('studentId', '==', ctx.studentId).limit(limit).get(),
    db.collection('submissions').where('studentId', '==', ctx.studentId).limit(limit).get(),
    db
      .collection('notifications')
      .where('studentId', '==', ctx.studentId)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get(),
    db.collection('course_fee_ledgers').where('studentId', '==', ctx.studentId).limit(25).get(),
    db
      .collection('receipts')
      .where('studentId', '==', ctx.studentId)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get(),
  ]);

  const visibleAssignmentDocs = assignmentsSnap.docs.filter((doc) => {
    const data = doc.data() || {};
    return canStudentAccessAssignment(
      { classId: data.classId, deliveryPolicy: data.deliveryPolicy },
      { classId, studentId: ctx.studentId }
    );
  });

  return {
    student,
    classInfo: classSnap?.exists ? projectClassDoc(classSnap as DashboardDoc) : null,
    assignments: mapDocs(
      { docs: visibleAssignmentDocs } as Pick<QuerySnapshot, 'docs'>,
      projectAssignmentDoc
    ),
    attendance: mapDocs(attendanceSnap, projectAttendanceDoc),
    evaluations: mapDocs(evaluationsSnap, projectEvaluationDoc),
    submissions: mapDocs(submissionsSnap, projectSubmissionDoc),
    notifications: mapDocs(notificationsSnap, projectNotificationDoc),
    tuition: {
      ledgers: mapDocs(ledgersSnap, projectLedgerDoc),
      receipts: mapDocs(receiptsSnap, projectReceiptDoc),
    },
  };
}
