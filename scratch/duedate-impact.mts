/** READ-ONLY: what applying the centre's own rule (termStart + 14 days) would do to every ledger. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const rem = (l: any) => Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);
const DUE_DAYS = 14;

const [ledgerSnap, enrollSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('student_course_enrollments').get(),
]);
const enrollPairs = new Set(enrollSnap.docs.map((d) => {
  const e = d.data() as any; return `${e.studentId}|${e.classId}`;
}));
let wouldBeOverdue = 0, overdueDebt = 0, stillFuture = 0, noTermStart = 0;
let orphanOverdue = 0, orphanOverdueDebt = 0;
const ageBuckets = new Map<string, number>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const ts = String(l.termStart || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ts)) { noTermStart++; continue; }
  const due = addDays(ts, DUE_DAYS);
  const debt = rem(l);
  if (debt <= 0) continue;
  if (due < today) {
    wouldBeOverdue++; overdueDebt += debt;
    const days = Math.floor((Date.parse(today) - Date.parse(due)) / 86400000);
    const b = days > 60 ? '> 60 ngày' : days > 30 ? '31-60 ngày' : days > 14 ? '15-30 ngày' : '<= 14 ngày';
    ageBuckets.set(b, (ageBuckets.get(b) || 0) + 1);
    if (!enrollPairs.has(`${l.studentId}|${l.classId}`)) { orphanOverdue++; orphanOverdueDebt += debt; }
  } else stillFuture++;
}
console.log(JSON.stringify({
  today, rule: `termStart + ${DUE_DAYS} ngày (NEXT_COURSE_TUITION_DUE_DAYS)`,
  totalLedgers: ledgerSnap.size,
  ledgersWithDueDateToday: 0,
  wouldBecomeOverdue: wouldBeOverdue, overdueDebt,
  wouldStayWithinDueDate: stillFuture,
  ledgersMissingTermStart: noTermStart,
  ofWhichAreOrphanLedgers: { count: orphanOverdue, debt: orphanOverdueDebt },
  overdueAgeBuckets: Object.fromEntries([...ageBuckets].sort()),
}, null, 2));
