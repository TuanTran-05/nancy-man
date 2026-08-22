/** READ-ONLY: how much debt the merge plan consolidates, and onto whom. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const plan = JSON.parse(await readFile(process.argv[2], 'utf8'));
const money = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
const rem = (l: any) => Math.max(0, money(l.amount) - money(l.paidTotal) - money(l.discountTotal));
const [ledgerSnap, classesSnap, studentsSnap] = await Promise.all([
  db.collection('course_fee_ledgers').get(), db.collection('classes').get(), db.collection('students').get(),
]);
const ledgerById = new Map(ledgerSnap.docs.map((d) => [d.id, d.data() as any]));
const classById = new Map(classesSnap.docs.map((d) => [d.id, d.data() as any]));
const studentById = new Map(studentsSnap.docs.map((d) => [d.id, d.data() as any]));
const rows: any[] = [];
for (const g of plan.groups) {
  if (!g.mergeable) continue;
  for (const m of g.moves) {
    if (m.collection !== 'course_fee_ledgers') continue;
    const l = ledgerById.get(m.fromDocId);
    if (!l) continue;
    rows.push({
      code: g.code, name: g.name,
      className: String(classById.get(String(l.classId||''))?.name || ''),
      debt: rem(l), paid: money(l.paidTotal),
      keepStudentClass: String(classById.get(String(studentById.get(g.keepId)?.classId||''))?.name || ''),
    });
  }
}
console.log(JSON.stringify({
  ledgersMoved: rows.length,
  debtConsolidated: rows.reduce((s,r)=>s+r.debt,0),
  moneyAlreadyPaidOnThose: rows.reduce((s,r)=>s+r.paid,0),
  sample: rows.slice(0,6),
}, null, 2));
