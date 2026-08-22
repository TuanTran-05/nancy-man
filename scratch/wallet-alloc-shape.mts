/** READ-ONLY: lấy đúng hình dạng một dòng allocation thật để bắt chước. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(initializeApp({ credential: cert(sa), projectId: sa.project_id }), databaseId);

const alloc = await db.collection('wallet_transactions').where('type', '==', 'allocation').limit(2).get();
const dep = await db
  .collection('wallet_transactions')
  .where('studentId', '==', 'b9C4QhZ1h7qQEFp8ChId')
  .get();

console.log(JSON.stringify({
  allocationSample: alloc.docs.map((d) => ({ __id: d.id, ...(d.data() as any) })),
  maiLyWalletRows: dep.docs.map((d) => ({ __id: d.id, ...(d.data() as any) })),
}, null, 2));
