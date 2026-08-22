import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  ACCOUNTING_STUDENT_SUMMARY_VERSION,
  refreshAccountingStudentSummariesAfterCommit,
  writeAccountingSummaryHealth,
} from '../server/api/lib/services/accountingStudentSummaryService.js';
import type { StudentIdentityMutationContext } from '../server/api/lib/maintenance/studentIdentityMutationTransaction.js';

export type SummaryRebuildResult = {
  scanned: number;
  rebuilt: number;
  queued: number;
  failed: number;
  nextCursor: string | null;
  complete: boolean;
  pruned: number;
  dryRun: boolean;
};

export type FullSummaryRebuildResult = {
  pages: number;
  scanned: number;
  rebuilt: number;
  queued: number;
  failed: number;
  pruned: number;
  complete: boolean;
  dryRun: boolean;
  studentCount: number;
  summaryCount: number;
  missingStudentIds: string[];
  orphanSummaryIds: string[];
  staleSummaryIds: string[];
};

type SummaryRebuildPageInput = {
  db: DocumentStore;
  apply?: boolean;
  cursor?: string;
  batchSize?: number;
  pruneOrphans?: boolean;
  writeHealth?: boolean;
  /** Required whenever `apply` is set; the rebuild writes as this operator. */
  context?: StudentIdentityMutationContext;
};

export interface FullSummaryRebuildDependencies {
  rebuildPage: (input: SummaryRebuildPageInput) => Promise<SummaryRebuildResult>;
  audit: typeof auditAccountingStudentSummaries;
  writeHealth: typeof writeAccountingSummaryHealth;
}

export async function auditAccountingStudentSummaries(db: DocumentStore) {
  const [students, summaries] = await Promise.all([
    db.collection('students').get(),
    db.collection('accounting_student_summaries').get(),
  ]);
  const studentIds = new Set(students.docs.map((doc) => doc.id));
  const summaryIds = new Set(summaries.docs.map((doc) => doc.id));
  const missingStudentIds = [...studentIds].filter((id) => !summaryIds.has(id)).sort();
  const orphanSummaryIds = [...summaryIds].filter((id) => !studentIds.has(id)).sort();
  const staleSummaryIds = summaries.docs
    .filter(
      (doc) =>
        studentIds.has(doc.id) &&
        Number((doc.data() as Record<string, unknown>).sourceVersion || 0) !==
          ACCOUNTING_STUDENT_SUMMARY_VERSION
    )
    .map((doc) => doc.id)
    .sort();
  return {
    studentCount: students.size,
    summaryCount: summaries.size,
    missingStudentIds,
    orphanSummaryIds,
    staleSummaryIds,
    valid:
      missingStudentIds.length === 0 &&
      orphanSummaryIds.length === 0 &&
      staleSummaryIds.length === 0,
  };
}

export async function rebuildAccountingStudentSummaries(
  input: SummaryRebuildPageInput
): Promise<SummaryRebuildResult> {
  const apply = input.apply === true;
  const batchSize = Math.min(200, Math.max(1, input.batchSize || 100));
  let query: AppDocumentStore.Query = input.db
    .collection('students')
    .orderBy('__name__')
    .limit(batchSize + 1);
  if (input.cursor) {
    const cursorSnapshot = await input.db.collection('students').doc(input.cursor).get();
    if (!cursorSnapshot.exists) throw new Error('ACCOUNTING_SUMMARY_CURSOR_NOT_FOUND');
    query = query.startAfter(cursorSnapshot);
  }
  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, batchSize);
  const hasMore = snapshot.docs.length > batchSize;
  const nextCursor = hasMore ? docs.at(-1)?.id || null : null;
  let rebuilt = 0;
  let queued = 0;
  let failed = 0;
  if (apply && docs.length > 0) {
    if (!input.context) throw new Error('ACCOUNTING_SUMMARY_ACTOR_REQUIRED');
    const refresh = await refreshAccountingStudentSummariesAfterCommit(
      input.db,
      docs.map((doc) => doc.id),
      'full-rebuild',
      input.context
    );
    rebuilt = refresh.rebuilt.length;
    queued = refresh.queued.length;
    failed = refresh.failed.length;
  }
  let pruned = 0;
  if (apply && input.pruneOrphans && !hasMore) {
    const [students, summaries] = await Promise.all([
      input.db.collection('students').get(),
      input.db.collection('accounting_student_summaries').get(),
    ]);
    const studentIds = new Set(students.docs.map((doc) => doc.id));
    for (const summary of summaries.docs) {
      if (!studentIds.has(summary.id)) {
        await summary.ref.delete();
        pruned += 1;
      }
    }
  }
  const result: SummaryRebuildResult = {
    scanned: docs.length,
    rebuilt,
    queued,
    failed,
    nextCursor,
    complete: !hasMore,
    pruned,
    dryRun: !apply,
  };
  if (apply && !hasMore && input.writeHealth !== false) {
    const audit = await auditAccountingStudentSummaries(input.db);
    await writeAccountingSummaryHealth(input.db, {
      studentCount: audit.studentCount,
      summaryCount: audit.summaryCount,
      repairBacklog: queued,
      failedCount: failed,
      missingSummaryCount: audit.missingStudentIds.length,
      orphanSummaryCount: audit.orphanSummaryIds.length,
      staleSummaryCount: audit.staleSummaryIds.length,
      complete:
        !input.cursor && queued === 0 && failed === 0 && rebuilt === docs.length && audit.valid,
    });
  }
  return result;
}

const defaultFullDependencies: FullSummaryRebuildDependencies = {
  rebuildPage: rebuildAccountingStudentSummaries,
  audit: auditAccountingStudentSummaries,
  writeHealth: writeAccountingSummaryHealth,
};

export async function rebuildAllAccountingStudentSummaries(input: {
  db: DocumentStore;
  apply?: boolean;
  batchSize?: number;
  pruneOrphans?: boolean;
  context?: StudentIdentityMutationContext;
  deps?: FullSummaryRebuildDependencies;
}): Promise<FullSummaryRebuildResult> {
  const deps = input.deps || defaultFullDependencies;
  const aggregate = { pages: 0, scanned: 0, rebuilt: 0, queued: 0, failed: 0, pruned: 0 };
  let cursor: string | undefined;
  let finalPageComplete: boolean;
  do {
    const page = await deps.rebuildPage({
      db: input.db,
      apply: input.apply,
      ...(cursor ? { cursor } : {}),
      batchSize: input.batchSize,
      pruneOrphans: input.pruneOrphans,
      writeHealth: false,
      ...(input.context ? { context: input.context } : {}),
    });
    aggregate.pages += 1;
    aggregate.scanned += page.scanned;
    aggregate.rebuilt += page.rebuilt;
    aggregate.queued += page.queued;
    aggregate.failed += page.failed;
    aggregate.pruned += page.pruned;
    finalPageComplete = page.complete;
    if (!page.complete && !page.nextCursor) {
      throw new Error('ACCOUNTING_SUMMARY_REBUILD_CURSOR_MISSING');
    }
    cursor = page.nextCursor || undefined;
  } while (!finalPageComplete);

  const audit = await deps.audit(input.db);
  const complete =
    finalPageComplete &&
    aggregate.queued === 0 &&
    aggregate.failed === 0 &&
    (input.apply !== true || aggregate.rebuilt === aggregate.scanned) &&
    audit.valid;
  if (input.apply === true) {
    await deps.writeHealth(input.db, {
      studentCount: audit.studentCount,
      summaryCount: audit.summaryCount,
      repairBacklog: aggregate.queued,
      failedCount: aggregate.failed,
      missingSummaryCount: audit.missingStudentIds.length,
      orphanSummaryCount: audit.orphanSummaryIds.length,
      staleSummaryCount: audit.staleSummaryIds.length,
      complete,
    });
  }
  return {
    ...aggregate,
    complete,
    dryRun: input.apply !== true,
    ...audit,
  };
}

export type AccountingSummaryRebuildCliOptions = {
  apply: boolean;
  all: boolean;
  cursor?: string;
  batchSize: number;
  pruneOrphans: boolean;
  /**
   * Who is running this. A rebuild writes through the same maintenance guard as
   * any other student mutation, so it has to name a real operator rather than
   * borrow a synthetic one.
   */
  actor?: string;
  migrationRunId?: string;
};

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
  return value;
}

export function parseAccountingSummaryRebuildArgs(
  argv: string[]
): AccountingSummaryRebuildCliOptions {
  const options: AccountingSummaryRebuildCliOptions = {
    apply: false,
    all: false,
    batchSize: 100,
    pruneOrphans: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--prune-orphans') options.pruneOrphans = true;
    else if (arg === '--cursor') {
      options.cursor = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--batch-size') {
      options.batchSize = Number(optionValue(argv, index, arg));
      if (
        !Number.isInteger(options.batchSize) ||
        options.batchSize < 1 ||
        options.batchSize > 200
      ) {
        throw new Error('ACCOUNTING_SUMMARY_BATCH_SIZE_INVALID');
      }
      index += 1;
    } else if (arg === '--actor') {
      options.actor = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--migration-run-id') {
      options.migrationRunId = optionValue(argv, index, arg);
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.all && options.cursor) throw new Error('ACCOUNTING_SUMMARY_ALL_CURSOR_CONFLICT');
  if (options.apply && !options.actor) throw new Error('ACCOUNTING_SUMMARY_ACTOR_REQUIRED');
  return options;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert({
        projectId: requiredEnv('FIREBASE_PROJECT_ID'),
        clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
        privateKey: requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
    });
  const options = parseAccountingSummaryRebuildArgs(process.argv.slice(2));
  const db = getDocumentStore(app, requiredEnv('FIRESTORE_DATABASE_ID'));
  const context: StudentIdentityMutationContext | undefined = options.actor
    ? {
        actorId: options.actor,
        operation: 'accounting-summary:full-rebuild',
        ...(options.migrationRunId ? { migrationRunId: options.migrationRunId } : {}),
      }
    : undefined;
  const result = options.all
    ? await rebuildAllAccountingStudentSummaries({
        db,
        apply: options.apply,
        batchSize: options.batchSize,
        pruneOrphans: options.pruneOrphans,
        ...(context ? { context } : {}),
      })
    : await rebuildAccountingStudentSummaries({
        db,
        apply: options.apply,
        cursor: options.cursor,
        batchSize: options.batchSize,
        pruneOrphans: options.pruneOrphans,
        ...(context ? { context } : {}),
      });
  console.log(JSON.stringify(result, null, 2));
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
