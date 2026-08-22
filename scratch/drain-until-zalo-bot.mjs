/** Rút outbox nhiều lượt cho tới khi job send_zalo_bot_message được xử lý. */
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

const raw = readFileSync('.vercel/.env.production.local', 'utf8');
const line = raw.split(/\r?\n/).find((l) => l.startsWith('CRON_SECRET='));
const secret = (line ? line.slice('CRON_SECRET='.length) : '').replace(/^"|"$/g, '');
if (secret.length !== 64) throw new Error(`CRON_SECRET len=${secret.length}`);

const url = 'https://vps.thienuy.edu.vn/api/audit/outbox-process';

async function botJobStatus() {
  const snap = await db
    .collection('outbox_jobs')
    .where('type', '==', 'send_zalo_bot_message')
    .get();
  return snap.docs.map((d) => `${d.data().status}(attempts=${d.data().attempts ?? 0})`).join(', ');
}

for (let run = 1; run <= 10; run++) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  const body = (await res.text()).slice(0, 160);
  const status = await botJobStatus();
  console.log(`luot ${run}: http=${res.status} ${body}`);
  console.log(`         send_zalo_bot_message -> ${status}`);

  if (!status.includes('pending') && !status.includes('processing')) {
    console.log('\n>>> JOB ZALO BOT DA CHAY XONG');
    break;
  }
  if (res.status !== 200) {
    console.log('\n>>> DUNG: lan rut that bai');
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
process.exit(0);
