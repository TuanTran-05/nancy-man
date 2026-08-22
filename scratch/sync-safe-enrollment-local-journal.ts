import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { canonicalJson } from '../scripts/student-enrollment-backfill/planner.js';
import {
  appendCreatedEnrollmentJournal,
  readApplyJournal,
  type SafeEnrollmentReviewedFile,
} from '../scripts/student-enrollment-backfill/reporter.js';
import {
  fingerprintEnrollmentPayload,
  loadSafeEnrollmentDurableJournal,
} from '../scripts/student-enrollment-backfill/writer.js';

const databaseId = 'ai-studio-4bd76afc-98c1-4f42-8d50-f17f1cfeb31a';
const planPath =
  'scratch/safe-enrollment-audit-2026-08-01-final/safe-enrollment-plan.json';
const journalPath =
  'scratch/safe-enrollment-apply-2026-08-01-8537fed0/safe-enrollment-apply-journal.json';
const reviewed = JSON.parse(await readFile(planPath, 'utf8')) as SafeEnrollmentReviewedFile;
const serviceAccount = JSON.parse(await readFile('service-account-key.json', 'utf8'));
const db = getDocumentStore(
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }),
  databaseId
);
const durable = await loadSafeEnrollmentDurableJournal({ db, reviewed });
const candidates = new Map(
  reviewed.plan.items.flatMap((item) =>
    item.decision === 'create' && item.candidate
      ? [[item.candidate.enrollment.id, item.candidate.enrollment] as const]
      : []
  )
);
if (durable.length !== reviewed.plan.summary.create) {
  throw new Error(`DURABLE_COUNT_MISMATCH:${durable.length}`);
}
for (const entry of durable) {
  const candidate = candidates.get(entry.documentId);
  if (
    !candidate ||
    entry.studentId !== candidate.studentId ||
    entry.createdAt !== candidate.createdAt ||
    entry.payloadFingerprint !== fingerprintEnrollmentPayload(candidate)
  ) {
    throw new Error(`DURABLE_ENTRY_MISMATCH:${entry.documentId}`);
  }
}
const binding = {
  migrationId: reviewed.plan.migrationId,
  digest: reviewed.digest,
  target: reviewed.target,
};
const before = await readApplyJournal(journalPath, binding);
const beforeIds = new Set(before.map((entry) => entry.documentId));
const missing = durable.filter((entry) => !beforeIds.has(entry.documentId));
for (const entry of missing) {
  await appendCreatedEnrollmentJournal({ journalPath, entry, binding });
}
const after = await readApplyJournal(journalPath, binding);
if (canonicalJson(after) !== canonicalJson(durable)) {
  throw new Error('LOCAL_JOURNAL_STILL_MISMATCHED');
}
console.log(
  JSON.stringify(
    { durableCount: durable.length, localBefore: before.length, synced: missing.length, localAfter: after.length },
    null,
    2
  )
);
process.exit(0);
