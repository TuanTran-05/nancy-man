/** READ-ONLY: confirm the enrollment collection really starts 2026-07-25 and no enrollment predates it. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const toIso = (v: any): string =>
  !v ? '' : typeof v === 'string' ? v : typeof v?.toDate === 'function' ? v.toDate().toISOString()
  : typeof v?._seconds === 'number' ? new Date(v._seconds * 1000).toISOString() : '';
const snap = await db.collection('student_course_enrollments').get();
let withCreated = 0, without = 0;
const bySource = new Map<string, number>();
const byMonth = new Map<string, number>();
for (const d of snap.docs) {
  const e = d.data() as any;
  const c = toIso(e.createdAt);
  if (c) { withCreated++; byMonth.set(c.slice(0,7), (byMonth.get(c.slice(0,7))||0)+1); } else without++;
  const s = String(e.source || '(none)');
  bySource.set(s, (bySource.get(s)||0)+1);
}
console.log(JSON.stringify({
  total: snap.size, withCreatedAt: withCreated, missingCreatedAt: without,
  createdByMonth: Object.fromEntries([...byMonth].sort()),
  bySource: Object.fromEntries(bySource),
}, null, 2));
