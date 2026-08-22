/** READ-ONLY: tình trạng thật của NGUYỄN LƯƠNG MAI LY sau hai đợt chạy. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';

const SID = 'b9C4QhZ1h7qQEFp8ChId';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const m = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

const [student, ledgers, receipts, wallet, enrolls, summary, classesSnap] = await Promise.all([
  db.collection('students').doc(SID).get(),
  db.collection('course_fee_ledgers').where('studentId', '==', SID).get(),
  db.collection('receipts').where('studentId', '==', SID).get(),
  db.collection('wallet_transactions').where('studentId', '==', SID).get(),
  db.collection('student_course_enrollments').where('studentId', '==', SID).get(),
  db.collection('accounting_student_summaries').doc(SID).get(),
  db.collection('classes').get(),
]);
const className = (id: string) => String((classesSnap.docs.find((d) => d.id === id)?.data() as any)?.name || id);

let walletBalance = 0;
for (const d of wallet.docs) {
  const t = d.data() as any;
  walletBalance += /deposit/i.test(String(t.type)) ? m(t.amount) : -m(t.amount);
}

const billed = ledgers.docs.reduce((s, d) => s + m((d.data() as any).amount), 0);
const paid = ledgers.docs.reduce((s, d) => s + m((d.data() as any).paidTotal), 0);
const discount = ledgers.docs.reduce((s, d) => s + m((d.data() as any).discountTotal), 0);

console.log(JSON.stringify({
  name: (student.data() as any)?.name,
  studentCode: (student.data() as any)?.studentId,
  totals: {
    billed, discount, paid,
    outstanding: Math.max(0, billed - discount - paid),
    walletBalance,
  },
  ledgers: ledgers.docs.map((d) => {
    const l = d.data() as any;
    return {
      id: d.id, class: className(String(l.classId)), termStart: l.termStart, termEnd: l.termEnd,
      amount: m(l.amount), paidTotal: m(l.paidTotal), status: l.status,
      remaining: Math.max(0, m(l.amount) - m(l.discountTotal) - m(l.paidTotal)),
    };
  }),
  receipts: receipts.docs.map((d) => {
    const r = d.data() as any;
    return {
      receiptNo: r.receiptNo, status: r.status, amountReceived: m(r.amountReceived),
      allocations: (r.allocations || []).map((a: any) => ({ ledgerId: a.ledgerId, amount: m(a.amount) })),
    };
  }),
  walletRows: wallet.docs.map((d) => {
    const t = d.data() as any;
    return { type: t.type, amount: m(t.amount), receiptNo: t.receiptNo, ledgerId: t.ledgerId || null };
  }),
  enrollments: enrolls.docs.map((d) => {
    const e = d.data() as any;
    const expected = makeStudentCourseEnrollmentId(String(e.studentId), String(e.classId), String(e.termStart));
    return {
      docId: d.id, expectedId: expected, idMatches: d.id === expected,
      class: className(String(e.classId)), termStart: e.termStart, termEnd: e.termEnd,
      status: e.status, joinedAt: e.joinedAt, endedAt: e.endedAt ?? null,
    };
  }),
  storedSummaryBadge: (summary.data() as any)?.currentCoursePaymentStatus ?? '(không có summary)',
  storedSummaryRebuiltAt: (summary.data() as any)?.rebuiltAt ?? null,
}, null, 2));
