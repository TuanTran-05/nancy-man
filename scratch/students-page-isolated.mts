/** READ-ONLY. Mỗi kênh một tiến trình con để telemetry nền không nhiễu số đo. */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';

const which = process.argv[2];
const sa = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(sa), projectId: sa.project_id }),
  'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a'
);
const readers: any = await import('../server/api/read/handlers/readers.js');
const ctx = { uid: 'AUDIT', role: 'admin', studentId: null } as never;
const req = (query: Record<string, string>) =>
  ({ query, headers: {}, method: 'GET' }) as never;

const jobs: Record<string, () => Promise<unknown>> = {
  students: () => readers.readStudents(db, ctx, req({ view: 'directory', limit: '1000' })),
  accounting: () => readers.readAccountingStudents(db, ctx, req({ limit: '2000' })),
  assignments: () => readers.readAssignments(db, ctx, req({ limit: '2000' })),
};

await jobs[which]!(); // warm the connection so we time the read, not the handshake
const started = Date.now();
await jobs[which]!();
console.error(`${which}: ${Date.now() - started} ms`);
process.exit(0);
