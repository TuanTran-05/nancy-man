/** READ-ONLY: if every ledger were deleted, what would "Tạo công nợ" actually rebuild? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { planClassLedgers } from '../server/api/lib/accounting/courseLedgerPlanner.js';
import { isOpenStudentCourseEnrollmentStatus } from '../shared/studentCourseEnrollment.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const [classesSnap, enrollSnap, studentsSnap, ledgerSnap, receiptsSnap, invoicesSnap, paymentsSnap, walletSnap] =
  await Promise.all([
    db.collection('classes').get(), db.collection('student_course_enrollments').get(),
    db.collection('students').get(), db.collection('course_fee_ledgers').get(),
    db.collection('receipts').get(), db.collection('invoices').get(),
    db.collection('payment_requests').get(), db.collection('wallet_transactions').get(),
  ]);

const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const enrollByClass = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const k = String(e.classId || '');
  if (!enrollByClass.has(k)) enrollByClass.set(k, []);
  enrollByClass.get(k)!.push(e);
}

let created = 0, amount = 0;
const skipReasons = new Map<string, number>();
const coveredStudents = new Set<string>();
const perClass: any[] = [];
for (const c of classesSnap.docs) {
  const classData = c.data() as any;
  const enrolls = (enrollByClass.get(c.id) || []).map((e) => ({
    id: e.id, studentId: String(e.studentId || ''), classId: c.id,
    termStart: String(e.termStart || ''), termEnd: e.termEnd ?? null, status: e.status,
  }));
  const plan = planClassLedgers({ classId: c.id, classData, enrollments: enrolls, ledgers: [] });
  if (plan.skipReason) {
    skipReasons.set(plan.skipReason, (skipReasons.get(plan.skipReason) || 0) + 1);
    continue;
  }
  created += plan.creates.length;
  amount += plan.creates.reduce((s, x) => s + x.amount, 0);
  for (const x of plan.creates) coveredStudents.add(x.studentId);
  if (plan.creates.length) perClass.push({ className: plan.className, ledgers: plan.creates.length, tuitionFee: plan.tuitionFee });
}

// who is actively studying but would get NO ledger?
const openEnrolledStudents = new Set<string>();
for (const d of enrollSnap.docs) {
  const e = d.data() as any;
  if (isOpenStudentCourseEnrollmentStatus(e.status)) openEnrolledStudents.add(String(e.studentId || ''));
}
const missed = [...openEnrolledStudents].filter((s) => !coveredStudents.has(s));
const activeStudentsNoEnrollment = studentsSnap.docs.filter((d) => {
  const s = d.data() as any;
  return ['active','on_leave'].includes(String(s.enrollmentStatus||'')) &&
    !enrollSnap.docs.some((e) => String((e.data() as any).studentId) === d.id);
});

console.log(JSON.stringify({
  wouldDelete: {
    course_fee_ledgers: ledgerSnap.size,
    receipts: receiptsSnap.size,
    invoices: invoicesSnap.size,
    payment_requests: paymentsSnap.size,
    wallet_transactions: walletSnap.size,
  },
  wouldRegenerate: { ledgers: created, totalAmount: amount, studentsCovered: coveredStudents.size },
  classesSkipped: Object.fromEntries(skipReasons),
  studentsWithOpenEnrollmentButNoLedger: missed.length,
  activeStudentsWithNoEnrollmentRowAtAll: activeStudentsNoEnrollment.length,
  activeStudentsMissedSample: activeStudentsNoEnrollment.slice(0, 8).map((d) => ({
    name: String((d.data() as any).name || ''), code: String((d.data() as any).studentId || ''),
    classId: String((d.data() as any).classId || ''),
  })),
  topClasses: perClass.sort((a,b)=>b.ledgers-a.ledgers).slice(0, 8),
}, null, 2));
