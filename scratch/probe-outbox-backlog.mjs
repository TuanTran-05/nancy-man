/** READ-ONLY: outbox đã xử lý những gì, và còn tồn đọng bao nhiêu. */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDocumentStore } from 'firebase-admin/documentStore';

const projectRoot = 'C:/Users/ASUS/Downloads/edutrack-smart-tracking-app (6)';
if (!getApps().length) {
  const p = path.join(projectRoot, 'service-account-key.json');
  if (!existsSync(p)) throw new Error('no service-account-key.json');
  initializeApp({ credential: cert(JSON.parse(readFileSync(p, 'utf8'))) });
}
const DB_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  JSON.parse(readFileSync(path.join(projectRoot, 'firebase.json'), 'utf8')).documentStore[0].database;
const db = getDocumentStore(getApps()[0], DB_ID);

const snap = await db.collection('outbox_jobs').get();
const byTypeStatus = new Map();
const recent = [];
for (const d of snap.docs) {
  const j = d.data();
  const key = `${j.type}  ${j.status}`;
  byTypeStatus.set(key, (byTypeStatus.get(key) || 0) + 1);
  recent.push({ id: d.id, type: j.type, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt });
}

console.log('=== outbox_jobs theo type + status ===');
for (const [k, v] of [...byTypeStatus.entries()].sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`  tong: ${snap.size}`);

console.log('\n=== 15 job cu nhat (theo createdAt) ===');
recent.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
for (const r of recent.slice(0, 15)) console.log(`  ${r.createdAt}  ${r.type}  ${r.status}`);

console.log('\n=== zalo_bot_messages ===');
const msgs = await db.collection('zalo_bot_messages').orderBy('createdAt', 'desc').limit(5).get();
for (const d of msgs.docs) {
  const m = d.data();
  console.log(`  ${m.messageType}  status=${m.status}  attempts=${m.attempts}  providerMessageId=${m.providerMessageId || '(none)'}  ${m.errorCode || ''} ${m.errorMessage || ''}`);
}
process.exit(0);
