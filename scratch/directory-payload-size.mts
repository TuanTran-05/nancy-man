/** READ-ONLY. Kích thước một trang directory 754 học sinh. */
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a'
);
const { readStudents } = await import('../server/api/read/handlers/readers.js');
const ctx = { uid: 'AUDIT', role: 'admin', studentId: null } as never;
const result: any = await readStudents(
  db as never,
  ctx,
  { query: { view: 'directory', limit: '1000' }, headers: {}, method: 'GET' } as never
);
const json = JSON.stringify(result);
console.log(`students trả về : ${result.students.length}`);
console.log(`JSON thô        : ${(json.length / 1024).toFixed(1)} KB`);
console.log(`sau gzip        : ${(gzipSync(json).length / 1024).toFixed(1)} KB`);
process.exit(0);
