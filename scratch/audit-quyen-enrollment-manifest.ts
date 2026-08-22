import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const report = JSON.parse(
  await readFile(
    'scratch/safe-enrollment-audit-2026-08-01-final/safe-enrollment-report.json',
    'utf8'
  )
);
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);
const [studentsSnapshot, classesSnapshot] = await Promise.all([
  db.collection('students').get(),
  db.collection('classes').get(),
]);
const students = new Map(studentsSnapshot.docs.map((doc) => [doc.id, doc.data()]));
const classes = new Map(classesSnapshot.docs.map((doc) => [doc.id, doc.data()]));
const normalize = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
const quyen = report.rows
  .map((row: Record<string, string>) => ({ row, student: students.get(row.studentId) || {} }))
  .filter(({ student }) => normalize(student.name || student.fullName).includes('quyen'))
  .map(({ row, student }) => ({
    studentId: row.studentId,
    studentCode: student.studentId || student.code || '',
    name: student.name || student.fullName || '',
    classId: row.classId,
    className: classes.get(row.classId)?.name || classes.get(row.classId)?.className || '',
    decision: row.decision,
    reason: row.reason,
    status: row.status,
    termStart: row.termStart,
    termEnd: row.termEnd,
  }));
const byClass = new Map<string, number>();
for (const row of report.rows as Array<Record<string, string>>) {
  if (row.decision !== 'create') continue;
  byClass.set(row.classId, (byClass.get(row.classId) || 0) + 1);
}
const classSummary = [...byClass.entries()]
  .map(([classId, count]) => ({
    classId,
    className: classes.get(classId)?.name || classes.get(classId)?.className || '',
    count,
  }))
  .sort((left, right) => right.count - left.count || left.classId.localeCompare(right.classId));
console.log(JSON.stringify({ quyen, classSummary }, null, 2));
process.exit(0);
