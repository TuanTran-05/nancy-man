/** READ-ONLY: does ANY ledger in this database carry a dueDate? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const isIso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const snap = await db.collection('course_fee_ledgers').get();
let withDue = 0, without = 0;
const samples: any[] = [];
for (const d of snap.docs) {
  const l = d.data() as any;
  if (isIso(l.dueDate)) { withDue++; if (samples.length < 5) samples.push({ id: d.id, dueDate: l.dueDate, termStart: l.termStart, termEnd: l.termEnd }); }
  else without++;
}
console.log(JSON.stringify({ totalLedgers: snap.size, withDueDate: withDue, withoutDueDate: without, samples }, null, 2));
