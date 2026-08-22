/** READ-ONLY: dấu vết webhook + trạng thái liên kết Zalo Bot. Không ghi gì. */
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
console.log('database:', DB_ID, '\n');

const redactKeys = new Set(['chatId', 'codeHash', 'chatIdHash']);
function show(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = redactKeys.has(k) && typeof v === 'string' ? `${v.slice(0, 8)}…(${v.length})` : v;
  }
  return out;
}

// 1. Webhook event markers — bằng chứng Zalo có gọi tới hay không.
console.log('=== _maintenance / zalo_bot_webhook (dấu vết webhook) ===');
const markers = await db
  .collection('_maintenance')
  .where('kind', '==', 'zalo_bot_webhook')
  .get();
if (markers.empty) {
  console.log('  KHÔNG CÓ MARKER NÀO — webhook chưa từng xử lý một message nào.');
} else {
  const rows = markers.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.createdAt}  outcome=${r.outcome}  event=${r.eventName}  ${r.id}`);
    if (r.staffId) console.log(`      staffId=${r.staffId} linkedAt=${r.linkedAt} confirmation=${r.confirmationStatus}`);
  }
  console.log(`  (tổng ${rows.length})`);
}

// 2. Mã liên kết đang phát hành.
console.log('\n=== zalo_bot_link_codes ===');
const codes = await db.collection('zalo_bot_link_codes').get();
if (codes.empty) console.log('  (trống)');
for (const d of codes.docs) console.log(' ', d.id.slice(0, 8) + '…', JSON.stringify(show(d.data())));

// 3. Liên kết.
console.log('\n=== zalo_bot_links ===');
const links = await db.collection('zalo_bot_links').get();
if (links.empty) console.log('  (trống)');
for (const d of links.docs) console.log(' ', d.id, JSON.stringify(show(d.data())));

// 4. Chat chờ ghép (tin nhắn thường, không phải /link).
console.log('\n=== zalo_bot_pending_chats ===');
const pending = await db.collection('zalo_bot_pending_chats').get();
if (pending.empty) console.log('  (trống)');
for (const d of pending.docs) console.log(' ', d.id.slice(0, 8) + '…', JSON.stringify(show(d.data())));

// 5. Ledger tin nhắn.
console.log('\n=== zalo_bot_messages (10 gần nhất) ===');
const msgs = await db.collection('zalo_bot_messages').orderBy('createdAt', 'desc').limit(10).get();
if (msgs.empty) console.log('  (trống)');
for (const d of msgs.docs) {
  const m = d.data();
  console.log(`  ${m.createdAt}  ${m.messageType}  status=${m.status}  attempts=${m.attempts}  ${m.errorCode || ''} ${m.errorMessage || ''}`);
}

// 6. Job outbox còn treo.
console.log('\n=== outbox: send_zalo_bot_message ===');
try {
  const jobs = await db
    .collection('outbox_jobs')
    .where('type', '==', 'send_zalo_bot_message')
    .get();
  if (jobs.empty) console.log('  (trống)');
  for (const d of jobs.docs) {
    const j = d.data();
    console.log(`  ${d.id}  status=${j.status}  attempts=${j.attempts}  ${j.lastError || ''}`);
  }
} catch (e) {
  console.log('  lỗi đọc outbox_jobs:', e.message);
}

process.exit(0);
