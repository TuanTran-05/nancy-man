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

const compact = <T extends Record<string, unknown>>(
  id: string,
  data: T
): Omit<T, 'id'> & { id: string } => ({ ...data, id });

const classesSnapshot = await db.collection('classes').get();
const candidates = classesSnapshot.docs.filter((doc) => {
  const data = doc.data();
  const text = normalize(`${data.name || ''} ${data.teacherName || ''} ${data.schedule || ''}`);
  return text.includes('basic 6') && text.includes('anh tuan');
});

const results = [];
for (const classDoc of candidates) {
  const classId = classDoc.id;
  const [enrollments, ledgers, students, evaluations, sessions, attendance, classAudits, receipts] =
    await Promise.all([
      db.collection('student_course_enrollments').where('classId', '==', classId).get(),
      db.collection('course_fee_ledgers').where('classId', '==', classId).get(),
      db.collection('students').where('classId', '==', classId).get(),
      db.collection('evaluations').where('classId', '==', classId).get(),
      db.collection('class_sessions').where('classId', '==', classId).get(),
      db.collection('attendance').where('classId', '==', classId).get(),
      db.collection('audit_logs').where('documentId', '==', classId).get(),
      db.collection('receipts').get(),
    ]);

  const ledgerIds = new Set(ledgers.docs.map((doc) => doc.id));
  const linkedReceipts = receipts.docs.filter((doc) => {
    const value = doc.data();
    if (value.classId === classId || ledgerIds.has(String(value.ledgerId || ''))) return true;
    return Array.isArray(value.allocations)
      ? value.allocations.some((allocation: Record<string, unknown>) =>
          ledgerIds.has(String(allocation?.ledgerId || ''))
        )
      : false;
  });

  const attendanceByDate = new Map<string, { count: number; statuses: Record<string, number> }>();
  for (const doc of attendance.docs) {
    const value = doc.data();
    const date = String(value.date || '');
    const status = String(value.status || 'unknown');
    const row = attendanceByDate.get(date) || { count: 0, statuses: {} };
    row.count += 1;
    row.statuses[status] = (row.statuses[status] || 0) + 1;
    attendanceByDate.set(date, row);
  }

  results.push({
    class: compact(classId, classDoc.data()),
    students: students.docs.map((doc) =>
      compact(doc.id, {
        name: doc.data().name,
        status: doc.data().status,
        joinedAt: doc.data().joinedAt,
        classId: doc.data().classId,
      })
    ),
    enrollments: enrollments.docs.map((doc) => compact(doc.id, doc.data())),
    ledgers: ledgers.docs.map((doc) => compact(doc.id, doc.data())),
    linkedReceipts: linkedReceipts.map((doc) => compact(doc.id, doc.data())),
    evaluations: evaluations.docs.map((doc) => compact(doc.id, doc.data())),
    sessions: sessions.docs
      .map((doc) => compact(doc.id, doc.data()))
      .sort((left, right) => String(left.date).localeCompare(String(right.date))),
    attendanceByDate: [...attendanceByDate.entries()]
      .map(([date, summary]) => ({ date, ...summary }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    attendanceRows: attendance.docs
      .map((doc) => compact(doc.id, doc.data()))
      .sort((left, right) => String(left.date).localeCompare(String(right.date))),
    classAudits: classAudits.docs
      .map((doc) => compact(doc.id, doc.data()))
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
      target: 'Basic 6 - Mr. Anh Tuan T3-T5',
      candidateCount: results.length,
      results: results.map((result) => ({
        class: {
          id: result.class.id,
          name: result.class.name,
          startDate: result.class.startDate,
          endDate: result.class.endDate,
          daysOfWeek: result.class.daysOfWeek,
          weeklySessions: result.class.weeklySessions,
          holidays: result.class.holidays,
          terms: result.class.terms,
          tuitionFee: result.class.tuitionFee,
          status: result.class.status,
        },
        studentDocumentCount: result.students.length,
        enrollments: result.enrollments.map((row) => ({
          id: row.id,
          studentId: row.studentId,
          termStart: row.termStart,
          termEnd: row.termEnd,
          joinedAt: row.joinedAt,
          endedAt: row.endedAt,
          status: row.status,
          source: row.source,
          confidence: row.confidence,
        })),
        ledgers: result.ledgers.map((row) => ({
          id: row.id,
          studentId: row.studentId,
          termStart: row.termStart,
          termEnd: row.termEnd,
          amount: row.amount,
          paidTotal: row.paidTotal,
          discountTotal: row.discountTotal,
          status: row.status,
          source: row.source,
          periodType: row.periodType,
          dueDate: row.dueDate,
          createdAt: row.createdAt,
        })),
        linkedReceipts: result.linkedReceipts.map((row) => ({
          id: row.id,
          studentId: row.studentId,
          classId: row.classId,
          ledgerId: row.ledgerId,
          allocations: row.allocations,
          amount: row.amount,
          paidAt: row.paidAt,
          date: row.date,
          status: row.status,
        })),
        evaluationDates: result.evaluations
          .map((row) => String(row.date || ''))
          .sort(),
        sessions: result.sessions.map((row) => ({
          id: row.id,
          date: row.date,
          status: row.status,
          teacherAttendanceStatus: row.teacherAttendanceStatus,
          teacherAttendanceSource: row.teacherAttendanceSource,
        })),
        attendanceByDate: result.attendanceByDate,
        attendanceRowCount: result.attendanceRows.length,
        classAudits: result.classAudits.map((row) => ({
          id: row.id,
          timestamp: row.timestamp,
          action: row.action,
          changes: row.changes,
          metadata: row.metadata,
        })),
      })),
      holidayAudits: holidayAudits.docs
        .map((doc) => compact(doc.id, doc.data()))
        .filter((value) => {
          const affected = (value.metadata as Record<string, unknown> | undefined)?.affectedClassIds;
          return (
            Array.isArray(affected) &&
            results.some((result) => affected.includes(String(result.class.id)))
          );
        }),
    },
    null,
    2
  )
);

process.exit(0);
