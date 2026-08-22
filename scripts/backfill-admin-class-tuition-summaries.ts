import { getApps, initializeApp, cert } from '@/server/db/documentStore.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import { rebuildAllAdminClassTuitionSnapshots } from '../server/api/lib/services/adminClassTuitionSnapshotService.js';

export async function runBackfill(args: string[] = process.argv.slice(2)) {
  const isDryRun = args.includes('--dry-run');

  if (getApps().length === 0) {
    if (process.env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      initializeApp();
    }
  }

  const db = getDocumentStore();
  console.log(`[BackfillAdminClassTuition] Starting backfill (dryRun=${isDryRun})...`);

  const result = await rebuildAllAdminClassTuitionSnapshots(db, { dryRun: isDryRun });

  console.log('[BackfillAdminClassTuition] Finished with summary:', {
    healthy: result.healthy,
    expectedCount: result.expectedCount,
    materializedCount: result.materializedCount,
    completeCount: result.completeCount,
    incompleteCount: result.incompleteCount,
    lastDailyRebuildAt: result.lastDailyRebuildAt,
  });

  return result;
}

if (process.argv[1]?.includes('backfill-admin-class-tuition-summaries')) {
  runBackfill().catch((err) => {
    console.error('[BackfillAdminClassTuition] Error:', err);
    process.exit(1);
  });
}
