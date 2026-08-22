/** READ-ONLY. Vòng lặp ledger trong readAccountingStudents chạy bao nhiêu chunk? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a'
);

const students = await db.collection('students').orderBy('name').limit(2000).select().get();
const ids = students.docs.map((d) => d.id);
console.log(`students trên trang: ${ids.length} -> ${Math.ceil(ids.length / 30)} chunk`);

const ledgerTotal = await db.collection('course_fee_ledgers').count().get();
console.log(`course_fee_ledgers tổng: ${ledgerTotal.data().count}`);

const seen = new Set<string>();
let kept = 0;
let chunksRun = 0;
const started = Date.now();
for (let i = 0; i < ids.length; i += 30) {
  chunksRun += 1;
  const snap = await db
    .collection('course_fee_ledgers')
    .where('studentId', 'in', ids.slice(i, i + 30))
    .limit(150)
    .get();
  for (const doc of snap.docs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    kept += 1;
    if (kept >= 300) break;
  }
  if (kept >= 300) break;
}
console.log(`chạy ${chunksRun} chunk, giữ ${kept} ledger, ${Date.now() - started} ms (tuần tự)`);
process.exit(0);
