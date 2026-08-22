/** READ-ONLY: every doc in every root collection referencing this student. */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDocumentStore } from 'firebase-admin/documentStore';

const projectRoot = 'C:/Users/ASUS/Downloads/edutrack-smart-tracking-app (6)';
const TOKENS = ['hMxfShwOf6cUjy8XDl8e', 'HS260548', 'BÀNG KIM BẢO'];

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(readFileSync(path.join(projectRoot, 'service-account-key.json'), 'utf8'))),
  });
}
const DB_ID = JSON.parse(readFileSync(path.join(projectRoot, 'firebase.json'), 'utf8')).documentStore[0]
  .database;
const db = getDocumentStore(getApps()[0], DB_ID);

const cols = await db.listCollections();
console.log('collections:', cols.map((c) => c.id).join(', '));

for (const col of cols) {
  const snap = await col.get();
  const hits = [];
  snap.forEach((d) => {
    const raw = JSON.stringify(d.data());
    if (TOKENS.some((t) => raw.includes(t)) || TOKENS.includes(d.id)) hits.push(d);
  });
  if (!hits.length) continue;
  console.log(`\n### ${col.id} — ${hits.length}/${snap.size} hits`);
  for (const d of hits) {
    const v = d.data();
    const keep = {};
    for (const [k, val] of Object.entries(v)) {
      const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (s.length < 400) keep[k] = typeof val === 'object' && val?.toDate ? String(val.toDate()) : val;
      else keep[k] = `[len ${s.length}]`;
    }
    console.log(`--- ${col.id}/${d.id}`);
    console.log(JSON.stringify(keep, null, 1).slice(0, 2000));
  }
}
process.exit(0);
