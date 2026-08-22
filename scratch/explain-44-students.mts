/** READ-ONLY: what is the real situation of the students whose ledgers have no enrollment? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const remaining = (l: any) => Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const today = new Date().toISOString().slice(0, 10);

const [studentsSnap, enrollSnap, ledgerSnap, classesSnap] = await Promise.all([
  db.collection('students').get(),
  db.collection('student_course_enrollments').get(),
  db.collection('course_fee_ledgers').get(),
  db.collection('classes').get(),
]);

const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const enrollByStudent = new Map<string, any[]>();
for (const d of enrollSnap.docs) {
  const e = d.data() as any;
  const k = String(e.studentId || '');
  if (!enrollByStudent.has(k)) enrollByStudent.set(k, []);
  enrollByStudent.get(k)!.push(e);
}
// every student doc grouped by their human student code, to find the "same person, newer record"
const docsByCode = new Map<string, any[]>();
for (const d of studentsSnap.docs) {
  const s = d.data() as any;
  const code = String(s.studentId || s.code || '').trim();
  if (!code) continue;
  if (!docsByCode.has(code)) docsByCode.set(code, []);
  docsByCode.get(code)!.push({ id: d.id, ...s });
}

const affected = new Map<string, any>();
for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const sid = String(l.studentId || '');
  const cid = String(l.classId || '');
  if ((enrollByStudent.get(sid) || []).some((e) => String(e.classId || '') === cid)) continue;
  if (!affected.has(sid)) affected.set(sid, { studentId: sid, ledgers: [] });
  affected.get(sid).ledgers.push({ classId: cid, remaining: remaining(l), termStart: l.termStart });
}

const rows: any[] = [];
for (const [sid, info] of affected) {
  const s = studentsSnap.docs.find((d) => d.id === sid);
  const data = (s?.data() || {}) as any;
  const code = String(data.studentId || data.code || '').trim();
  const ownClass = classById.get(String(data.classId || ''));
  const siblingsDocs = (docsByCode.get(code) || []).filter((x) => x.id !== sid);
  const newer = siblingsDocs.map((x) => {
    const c = classById.get(String(x.classId || ''));
    return {
      id: x.id,
      classId: String(x.classId || ''),
      className: String(c?.name || ''),
      classStatus: String(c?.status || ''),
      classEndDate: String(c?.endDate || ''),
      enrollmentStatus: String(x.enrollmentStatus || ''),
      lifecycle: String(x.studentLifecycle || ''),
      enrollments: (enrollByStudent.get(x.id) || []).length,
      openEnrollments: (enrollByStudent.get(x.id) || []).filter((e) =>
        ['trial', 'active', 'on_leave'].includes(String(e.status))
      ).length,
    };
  });
  rows.push({
    name: String(data.name || ''),
    code,
    docId: sid,
    enrollmentStatus: String(data.enrollmentStatus || ''),
    lifecycle: String(data.studentLifecycle || '(absent)'),
    statusNote: String(data.statusNote || ''),
    ownClassName: String(ownClass?.name || ''),
    ownClassStatus: String(ownClass?.status || ''),
    ownClassEndDate: String(ownClass?.endDate || ''),
    ownClassEnded: Boolean(ownClass?.endDate && String(ownClass.endDate) < today),
    debt: info.ledgers.reduce((s: number, l: any) => s + l.remaining, 0),
    hasNewerRecord: newer.length > 0,
    newerRecords: newer,
  });
}

const withNewer = rows.filter((r) => r.hasNewerRecord);
const withoutNewer = rows.filter((r) => !r.hasNewerRecord);
const newerStudying = withNewer.filter((r) => r.newerRecords.some((n: any) => n.openEnrollments > 0));

console.log(
  JSON.stringify(
    {
      today,
      affectedStudentDocs: rows.length,
      totalDebt: rows.reduce((s, r) => s + r.debt, 0),
      byEnrollmentStatus: Object.fromEntries(
        [...rows.reduce((m, r) => m.set(r.enrollmentStatus, (m.get(r.enrollmentStatus) || 0) + 1), new Map())]
      ),
      ownClassStatus: Object.fromEntries(
        [...rows.reduce((m, r) => m.set(r.ownClassStatus || '(none)', (m.get(r.ownClassStatus || '(none)') || 0) + 1), new Map())]
      ),
      ownClassAlreadyEnded: rows.filter((r) => r.ownClassEnded).length,
      hasNewerRecordSameCode: withNewer.length,
      newerRecordIsActivelyStudying: newerStudying.length,
      noNewerRecord: withoutNewer.length,
      debtOnRecordsWithNewer: withNewer.reduce((s, r) => s + r.debt, 0),
      debtOnRecordsWithoutNewer: withoutNewer.reduce((s, r) => s + r.debt, 0),
      sampleWithNewer: withNewer.slice(0, 4),
      sampleWithoutNewer: withoutNewer.slice(0, 4),
    },
    null,
    2
  )
);
