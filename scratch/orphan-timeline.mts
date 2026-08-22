/** READ-ONLY: is the orphan-ledger problem still producing new rows, or did it stop? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);

const toIso = (v: any): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (typeof v?._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return '';
};
const month = (v: string) => (v ? v.slice(0, 7) : '(unknown)');

const [ledgerSnap, enrollSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(),
  db.collection('student_course_enrollments').get(),
]);

const enrollPairs = new Set(
  enrollSnap.docs.map(
    (d) => `${String((d.data() as any).studentId || '')}|${String((d.data() as any).classId || '')}`
  )
);

const allByMonth = new Map<string, number>();
const orphanByMonth = new Map<string, number>();
const orphanDates: string[] = [];
const allDates: string[] = [];

for (const d of ledgerSnap.docs) {
  const l = d.data() as any;
  const created = toIso(l.createdAt);
  allDates.push(created);
  allByMonth.set(month(created), (allByMonth.get(month(created)) || 0) + 1);
  const pair = `${String(l.studentId || '')}|${String(l.classId || '')}`;
  if (!enrollPairs.has(pair)) {
    orphanByMonth.set(month(created), (orphanByMonth.get(month(created)) || 0) + 1);
    orphanDates.push(created);
  }
}

const enrollDates = enrollSnap.docs.map((d) => toIso((d.data() as any).createdAt)).filter(Boolean).sort();
orphanDates.sort();
allDates.sort();

console.log(
  JSON.stringify(
    {
      ledgersCreatedByMonth: Object.fromEntries([...allByMonth].sort()),
      orphanLedgersCreatedByMonth: Object.fromEntries([...orphanByMonth].sort()),
      newestOrphanLedger: orphanDates[orphanDates.length - 1] || '(none)',
      newestLedgerOverall: allDates[allDates.length - 1] || '(none)',
      oldestEnrollmentRow: enrollDates[0] || '(none)',
      newestEnrollmentRow: enrollDates[enrollDates.length - 1] || '(none)',
      enrollmentRowsTotal: enrollSnap.size,
    },
    null,
    2
  )
);
