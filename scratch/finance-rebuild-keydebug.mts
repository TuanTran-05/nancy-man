/** READ-ONLY: why did every planned key miss every existing ledger? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { planClassLedgers } from '../server/api/lib/accounting/courseLedgerPlanner.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const [classesSnap, enrollSnap, ledgerSnap] = await Promise.all([
  db.collection('classes').get(),
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
]);

const enrollByClass = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = { id: d.id, ...(d.data() as any) };
  const k = String(e.classId || '');
  if (!enrollByClass.has(k)) enrollByClass.set(k, []);
  enrollByClass.get(k)!.push(e);
}

// pick one class that has both ledgers and enrollments
const ledgers = ledgerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
const sampleClassId = String(ledgers[0].classId);
const c = classesSnap.docs.find((d) => d.id === sampleClassId)!;
const enrolls = (enrollByClass.get(sampleClassId) || []).map((e) => ({
  id: e.id, studentId: String(e.studentId || ''), classId: sampleClassId,
  termStart: String(e.termStart || ''), termEnd: e.termEnd ?? null, status: e.status,
}));
const plan = planClassLedgers({ classId: sampleClassId, classData: c.data() as any, enrollments: enrolls, ledgers: [] });

console.log(JSON.stringify({
  sampleClassId,
  className: plan.className,
  skipReason: plan.skipReason,
  plannedSample: plan.creates.slice(0, 3).map((x: any) => ({
    id: x.id, studentId: x.studentId, termStart: x.termStart, amount: x.amount,
    keys: Object.keys(x),
  })),
  enrollmentSample: enrolls.slice(0, 3).map((e) => ({ studentId: e.studentId, termStart: e.termStart, status: e.status })),
  ledgerSample: ledgers.filter((l) => String(l.classId) === sampleClassId).slice(0, 3).map((l) => ({
    id: l.id, studentId: l.studentId, termStart: l.termStart, termEnd: l.termEnd, amount: l.amount,
  })),
}, null, 2));
