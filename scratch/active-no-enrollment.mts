/** READ-ONLY: the students that are still marked active yet carry a ledger with no enrollment. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const rem = (l: any) => Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const [studentsSnap, enrollSnap, ledgerSnap, classesSnap] = await Promise.all([
  db.collection('students').get(), db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(), db.collection('classes').get(),
]);
const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const enrollByStudent = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = d.data() as any; const k = String(e.studentId || '');
  if (!enrollByStudent.has(k)) enrollByStudent.set(k, []);
  enrollByStudent.get(k)!.push(e);
}
const out: any[] = [];
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const sid = String(l.studentId || ''), cid = String(l.classId || '');
  if ((enrollByStudent.get(sid) || []).some((e) => String(e.classId || '') === cid)) continue;
  const s = studentsSnap.docs.find((x) => x.id === sid);
  const data = (s?.data() || {}) as any;
  if (String(data.enrollmentStatus || '') !== 'active') continue;
  const c = classById.get(cid);
  out.push({
    name: String(data.name || ''), code: String(data.studentId || ''),
    ledgerClass: String(c?.name || ''), classStatus: String(c?.status || ''),
    classEndDate: String(c?.endDate || ''), studentClassId: String(data.classId || ''),
    sameClass: String(data.classId || '') === cid,
    debt: rem(l), termStart: String(l.termStart || ''),
    enrollmentsAnywhere: (enrollByStudent.get(sid) || []).map((e) => ({
      classId: String(e.classId || ''), className: String(classById.get(String(e.classId||''))?.name || ''),
      status: String(e.status || ''), termStart: String(e.termStart || ''),
    })),
  });
}
console.log(JSON.stringify({ count: out.length, totalDebt: out.reduce((s,r)=>s+r.debt,0), rows: out }, null, 2));
