/** READ-ONLY: job nào vừa được xử lý trong lần rút lúc ~20:35 UTC. */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDocumentStore } from 'firebase-admin/documentStore';

const projectRoot = 'C:/Users/ASUS/Downloads/edutrack-smart-tracking-app (6)';
if (!getApps().length) {
  const p = path.join(projectRoot, 'service-account-key.json');
  initializeApp({ credential: cert(JSON.parse(readFileSync(p, 'utf8'))) });
}
const DB_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  JSON.parse(readFileSync(path.join(projectRoot, 'firebase.json'), 'utf8')).documentStore[0].database;
const db = getDocumentStore(getApps()[0], DB_ID);

const SINCE = process.argv[2] || '2026-08-15T20:30:00.000Z';
const snap = await db.collection('outbox_jobs').get();

// Outbox lưu mốc thời gian dưới dạng DocumentStore Timestamp, không phải chuỗi ISO.
function iso(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return '';
}

const touched = [];
for (const d of snap.docs) {
  const j = d.data();
  const stamps = [j.updatedAt, j.completedAt, j.lastAttemptAt, j.processedAt].map(iso).filter(Boolean);
  if (stamps.some((s) => s >= SINCE)) {
    touched.push({
      id: d.id,
      type: j.type,
      status: j.status,
      createdAt: iso(j.createdAt),
      updatedAt: iso(j.updatedAt),
    });
  }
}

console.log(`=== job co dau vet sau ${SINCE} : ${touched.length} ===`);
const byType = new Map();
for (const t of touched) byType.set(`${t.type} ${t.status}`, (byType.get(`${t.type} ${t.status}`) || 0) + 1);
for (const [k, v] of [...byType.entries()].sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log('\n=== 20 dong dau (createdAt -> updatedAt) ===');
touched.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
for (const t of touched.slice(0, 20)) {
  console.log(`  tao ${t.createdAt}  ->  chay ${t.updatedAt}  ${t.type}  ${t.status}`);
}
process.exit(0);
