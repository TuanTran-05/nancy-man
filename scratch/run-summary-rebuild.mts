/** Wrapper: runs the repo's accounting summary rebuild with credentials from service-account-key.json. Dry run unless --apply. */
import { readFile } from 'node:fs/promises';
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { rebuildAllAccountingStudentSummaries } from '../scripts/rebuild-accounting-student-summaries.js';

const APPLY = process.argv.includes('--apply');
const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getDocumentStore(app, databaseId);

const result = await rebuildAllAccountingStudentSummaries({
  db,
  apply: APPLY,
  batchSize: 100,
  pruneOrphans: false,
});
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...result }, null, 2));
