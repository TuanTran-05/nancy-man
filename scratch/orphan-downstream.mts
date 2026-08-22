/** READ-ONLY: can the downstream flows actually handle the ledgers with no enrollment? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const rem = (l: any) => Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const isIso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const [enrollSnap, ledgerSnap, closingSnap, studentsSnap] = await Promise.all([
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
  db.collection('course_closing_records').get(),
  db.collection('students').get(),
]);
const enrollPairs = new Set(enrollSnap.docs.map((d) => {
  const e = d.data() as any; return `${e.studentId}|${e.classId}`;
}));
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));

const orphan: any[] = [], orphanStudentIds = new Set<string>();
for (const d of ledgerSnap.docs) {
  const l = { id: d.id, ...(d.data() as any) };
  if (enrollPairs.has(`${l.studentId}|${l.classId}`)) continue;
  orphan.push(l); orphanStudentIds.add(String(l.studentId || ''));
}

// 1. Zalo reminder: it throws if ANY debt-carrying ledger of that student lacks term dates
const badTerms = orphan.filter((l) => rem(l) > 0 && (!isIso(l.termStart) || !isIso(l.termEnd)));
// 2. would a reminder for these students blow up on ANY of their ledgers (orphan or not)?
const brokenForStudent: string[] = [];
for (const sid of orphanStudentIds) {
  const all = ledgerSnap.docs.map((d) => d.data() as any).filter((l) => String(l.studentId) === sid);
  if (all.some((l) => rem(l) > 0 && (!isIso(l.termStart) || !isIso(l.termEnd)))) brokenForStudent.push(sid);
}
// 3. course closing records referencing these students
const closingHits = closingSnap.docs.filter((d) => orphanStudentIds.has(String((d.data() as any).studentId || '')));
// 4. wallet: any of them hold a balance that could absorb the debt?
let walletCovering = 0, walletTotal = 0;
for (const sid of orphanStudentIds) {
  const b = money(studentById.get(sid)?.walletBalance);
  if (b > 0) { walletCovering += 1; walletTotal += b; }
}
console.log(JSON.stringify({
  orphanLedgers: orphan.length,
  orphanStudents: orphanStudentIds.size,
  zaloReminder: {
    ledgersMissingTermDates: badTerms.length,
    studentsWhoseReminderWouldFail: brokenForStudent.length,
    verdict: badTerms.length === 0 ? 'nhắc học phí chạy được' : 'nhắc học phí sẽ lỗi 400',
  },
  termStartPresent: orphan.filter((l) => isIso(l.termStart)).length,
  termEndPresent: orphan.filter((l) => isIso(l.termEnd)).length,
  dueDatePresent: orphan.filter((l) => isIso(l.dueDate)).length,
  courseClosingRecordsForTheseStudents: closingHits.length,
  wallet: { studentsWithBalance: walletCovering, total: walletTotal },
}, null, 2));
