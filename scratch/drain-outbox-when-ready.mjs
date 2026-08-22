/** Chờ deployment mới lên rồi rút outbox. Không in CRON_SECRET. */
import { readFileSync } from 'fs';

const raw = readFileSync('.vercel/.env.production.local', 'utf8');
const m = raw.split(/\r?\n/).find((l) => l.startsWith('CRON_SECRET='));
const secret = (m ? m.slice('CRON_SECRET='.length) : '').replace(/^"|"$/g, '');
if (secret.length !== 64) throw new Error(`CRON_SECRET khong doc duoc (len=${secret.length})`);

const url = 'https://vps.thienuy.edu.vn/api/audit/outbox-process';
const deadline = Date.now() + 8 * 60 * 1000;

while (Date.now() < deadline) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  const body = (await res.text()).slice(0, 200);
  console.log(new Date().toISOString().slice(11, 19), res.status, body);
  if (res.status === 200) {
    console.log('>>> DA RUT OUTBOX');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('>>> HET GIO');
process.exit(1);
