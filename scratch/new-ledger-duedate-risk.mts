/** READ-ONLY: would ledgers created from now on land already overdue? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { courseTuitionDueDate } from '../shared/tuitionDueDate.js';
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);
const toIso = (v: any): string => !v ? '' : typeof v === 'string' ? v
  : typeof v?.toDate === 'function' ? v.toDate().toISOString() : '';
const today = new Date().toISOString().slice(0, 10);
const snap = await db.collection('course_fee_ledgers').get();
// how far behind the creation date does termStart usually sit?
const recent = snap.docs.map((d) => {
  const l = d.data() as any;
  return { created: toIso(l.createdAt).slice(0,10), termStart: String(l.termStart || '') };
}).filter((r) => r.created >= '2026-08-01');
const lagBuckets = new Map<string, number>();
let instantlyOverdue = 0;
for (const r of recent) {
  const lag = Math.floor((Date.parse(r.created) - Date.parse(r.termStart)) / 86400000);
  const b = lag <= 0 ? 'tạo TRƯỚC khi khóa bắt đầu' : lag <= 14 ? 'tạo trong 14 ngày đầu khóa' : 'tạo SAU 14 ngày';
  lagBuckets.set(b, (lagBuckets.get(b) || 0) + 1);
  if (courseTuitionDueDate(r.termStart) < r.created) instantlyOverdue++;
}
console.log(JSON.stringify({
  today,
  ledgersCreatedInAugust: recent.length,
  creationTimingVsCourseStart: Object.fromEntries(lagBuckets),
  wouldHaveBeenOverdueTheDayTheyWereCreated: instantlyOverdue,
}, null, 2));
