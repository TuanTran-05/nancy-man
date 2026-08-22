import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);
const normalize = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
const classesSnapshot = await db.collection('classes').get();
const candidates = classesSnapshot.docs.filter((doc) => {
  const data = doc.data();
  const text = normalize(`${data.name || ''} ${data.teacherName || ''}`);
  return text.includes('huynh le') || (text.includes('g3') && text.includes('le'));
});
const result = [];
for (const classDoc of candidates) {
  const data = classDoc.data();
  const [enrollments, ledgers, students, evaluations, sessions, attendance] = await Promise.all([
    db.collection('student_course_enrollments').where('classId', '==', classDoc.id).get(),
    db.collection('course_fee_ledgers').where('classId', '==', classDoc.id).get(),
    db.collection('students').where('classId', '==', classDoc.id).get(),
    db.collection('evaluations').where('classId', '==', classDoc.id).get(),
    db.collection('class_sessions').where('classId', '==', classDoc.id).get(),
    db.collection('attendance').where('classId', '==', classDoc.id).get(),
  ]);
  const audits = await db.collection('audit_logs').where('documentId', '==', classDoc.id).get();
  const enrollmentRanges = new Map<string, number>();
  for (const doc of enrollments.docs) {
    const value = doc.data();
    const key = `${value.termStart || ''}|${value.termEnd || ''}|${value.status || ''}|${value.source || ''}`;
    enrollmentRanges.set(key, (enrollmentRanges.get(key) || 0) + 1);
  }
  const ledgerRanges = new Map<string, number>();
  for (const doc of ledgers.docs) {
    const value = doc.data();
    const key = `${value.termStart || ''}|${value.termEnd || ''}|${value.status || ''}|${value.totalSessions || value.sessionCount || ''}`;
    ledgerRanges.set(key, (ledgerRanges.get(key) || 0) + 1);
  }
  result.push({
    classId: classDoc.id,
    class: {
      name: data.name,
      teacherName: data.teacherName,
      grade: data.grade,
      startDate: data.startDate,
      endDate: data.endDate,
      totalSessions: data.totalSessions,
      sessionCount: data.sessionCount,
      numberOfSessions: data.numberOfSessions,
      weeklySessions: data.weeklySessions,
      daysOfWeek: data.daysOfWeek,
      terms: data.terms,
      updatedAt: data.updatedAt,
    },
    currentStudentCount: students.size,
    enrollmentCount: enrollments.size,
    enrollmentRanges: [...enrollmentRanges.entries()].map(([range, count]) => ({ range, count })),
    ledgerCount: ledgers.size,
    ledgerRanges: [...ledgerRanges.entries()].map(([range, count]) => ({ range, count })),
    evaluationDates: [...new Map(evaluations.docs.map((doc) => [String(doc.data().date || ''), 0])).keys()]
      .map((date) => ({
        date,
        count: evaluations.docs.filter((doc) => String(doc.data().date || '') === date).length,
      })),
    sessionDates: sessions.docs.map((doc) => String(doc.data().date || '')).sort(),
    attendanceDates: [...new Set(attendance.docs.map((doc) => String(doc.data().date || '')))].sort(),
    attendanceCount: attendance.size,
    audits: audits.docs
      .map((doc) => {
        const value = doc.data();
        return {
          timestamp: value.timestamp,
          action: value.action,
          userName: value.userName,
          changes: value.changes,
          metadata: value.metadata,
        };
      })
      .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))),
  });
}
const holidayAudits = await db
  .collection('audit_logs')
  .where('documentId', '==', 'system_settings/holidays')
  .get();
console.log(
  JSON.stringify(
    {
      classes: result,
      holidayAudits: holidayAudits.docs
        .map((doc) => doc.data())
        .filter((value) =>
          Array.isArray(value.metadata?.affectedClassIds)
            ? value.metadata.affectedClassIds.includes('MbEjkY4bZPvUt9ykRpPu')
            : false
        )
        .map((value) => ({ timestamp: value.timestamp, userName: value.userName, metadata: value.metadata })),
    },
    null,
    2
  )
);
process.exit(0);
