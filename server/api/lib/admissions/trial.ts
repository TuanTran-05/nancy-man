import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { appendAdmissionHistory } from './history.js';

export async function countTrialAttendance(
  db: DocumentStore,
  studentId: string,
  classId: string,
  trialStartedAt?: string
) {
  const snap = await db
    .collection('attendance')
    .where('studentId', '==', studentId)
    .where('classId', '==', classId)
    .get();
  const countedDates = new Set<string>();
  const startMs = trialStartedAt ? new Date(trialStartedAt).getTime() : 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const status = String(data.status || '');
    const date = String(data.date || '');
    if (status !== 'present' && status !== 'late') continue;
    if (startMs && new Date(`${date}T23:59:59`).getTime() < startMs) continue;
    if (date) countedDates.add(date);
  }
  return countedDates.size;
}

export async function refreshTrialReviewStatus(
  db: DocumentStore,
  studentId: string,
  actor: { uid: string; role: string }
) {
  const studentRef = db.collection('students').doc(studentId);
  const snap = await studentRef.get();
  if (!snap.exists) return { updated: false, trialSessionCount: 0 };
  const student = snap.data() || {};
  if (student.studentLifecycle !== 'trial') return { updated: false, trialSessionCount: 0 };
  const currentStatus = String(student.trialReviewStatus || 'pending_sessions');
  if (currentStatus === 'accepted' || currentStatus === 'rejected') {
    return { updated: false, trialSessionCount: 0 };
  }
  const classId = String(student.classId || student.trialClassId || '');
  if (!classId) return { updated: false, trialSessionCount: 0 };
  const trialSessionCount = await countTrialAttendance(
    db,
    studentId,
    classId,
    typeof student.trialStartedAt === 'string' ? student.trialStartedAt : undefined
  );
  const nextStatus = trialSessionCount >= 2 ? 'pending_teacher_review' : 'pending_sessions';
  if (nextStatus !== currentStatus || student.trialSessionCount !== trialSessionCount) {
    await studentRef.update({
      trialReviewStatus: nextStatus,
      trialSessionCount,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (nextStatus === 'pending_teacher_review') {
      await appendAdmissionHistory(db, {
        studentId,
        action: 'teacher_review_ready',
        actorId: actor.uid,
        actorRole: actor.role,
        classId,
        teacherId: String(student.teacherId || ''),
        trialSessionCount,
      });
    }
    return { updated: true, trialSessionCount };
  }
  return { updated: false, trialSessionCount };
}
