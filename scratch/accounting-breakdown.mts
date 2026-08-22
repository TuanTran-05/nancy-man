/** READ-ONLY. Còn lại gì trong accounting-students sau ba sửa đổi? */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a'
);
const { attachSiblingGroupMembers } = await import('../server/api/read/handlers/readers.js');

await db.collection('classes').limit(1).get(); // warm

let t = Date.now();
const [classes, teachers] = await Promise.all([
  db.collection('classes').orderBy('name').limit(2000).get(),
  db.collection('users').where('role', '==', 'teacher').limit(2000).get(),
]);
console.log(`classes+teachers song song : ${Date.now() - t} ms (${classes.size}+${teachers.size})`);

t = Date.now();
const page = await db.collection('students').orderBy('name').limit(2000).get();
console.log(`trang students             : ${Date.now() - t} ms (${page.size})`);

t = Date.now();
const widened = await attachSiblingGroupMembers(db as never, page.docs as never);
console.log(`attachSiblingGroupMembers  : ${Date.now() - t} ms (${page.size} -> ${widened.length})`);

const ids = widened.map((d: any) => d.id);
t = Date.now();
let kept = 0;
const seen = new Set<string>();
const all: string[][] = [];
for (let i = 0; i < ids.length; i += 30) all.push(ids.slice(i, i + 30));
outer: for (let w = 0; w < all.length; w += 6) {
  const snaps = await Promise.all(
    all.slice(w, w + 6).map((group) =>
      db.collection('course_fee_ledgers').where('studentId', 'in', group).limit(150).get()
    )
  );
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      if (++kept >= 300) break outer;
    }
  }
}
console.log(`ledger theo đợt 6          : ${Date.now() - t} ms (${kept} ledger)`);
process.exit(0);
