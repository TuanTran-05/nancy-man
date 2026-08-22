import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import { getVietnamTodayStr } from '../shared/classSchedule.js';
import { loadSafeEnrollmentSources } from './student-enrollment-backfill/documentStoreSources.js';
import {
  assertSafeEnrollmentPlan,
  canonicalJson,
  planSafeStudentEnrollmentBackfill,
} from './student-enrollment-backfill/planner.js';
import {
  appendCreatedEnrollmentJournal,
  readApplyJournal,
  readReviewedSafeEnrollmentPlan,
  writeSafeEnrollmentReports,
} from './student-enrollment-backfill/reporter.js';
import {
  applySafeEnrollmentBackfill,
  applySafeEnrollmentRollback,
  loadSafeEnrollmentDurableJournal,
  planSafeEnrollmentRollback,
  preflightSafeEnrollmentApply,
  verifySafeEnrollmentApply,
  verifySafeEnrollmentRollback,
} from './student-enrollment-backfill/writer.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP_TEXT = `
safe-student-course-enrollment-backfill

Dry-run:
  npm run audit:student-course-enrollments -- --report-dir REPORT_DIR

Apply reviewed plan:
  npm run repair:student-course-enrollments -- --reviewed-plan PLAN_PATH
    --confirm-digest SHA256 --confirm-project PROJECT_ID
    --confirm-database DATABASE_ID --report-dir NEW_REPORT_DIR

Verify reviewed plan:
  npm run verify:student-course-enrollments -- --reviewed-plan PLAN_PATH
    --confirm-digest SHA256

Rollback defaults to read-only planning. Add --apply and exact target confirmations
only after the rollback plan has been reviewed.
`;

export type SafeEnrollmentBackfillMode = 'dry-run' | 'apply' | 'verify' | 'rollback';

export type SafeEnrollmentBackfillCliOptions = {
  mode: SafeEnrollmentBackfillMode;
  applyRollback: boolean;
  reportDir: string;
  reviewedPlanPath?: string;
  confirmDigest?: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
  applyJournalPath?: string;
  help: boolean;
};

export interface SafeEnrollmentRunnerDependencies {
  loadSources: typeof loadSafeEnrollmentSources;
  writeReports: typeof writeSafeEnrollmentReports;
  readReviewed: typeof readReviewedSafeEnrollmentPlan;
  preflight: typeof preflightSafeEnrollmentApply;
  apply: typeof applySafeEnrollmentBackfill;
  verify: typeof verifySafeEnrollmentApply;
  appendJournal: typeof appendCreatedEnrollmentJournal;
  readJournal: typeof readApplyJournal;
  loadDurableJournal: typeof loadSafeEnrollmentDurableJournal;
  planRollback: typeof planSafeEnrollmentRollback;
  applyRollback: typeof applySafeEnrollmentRollback;
  verifyRollback: typeof verifySafeEnrollmentRollback;
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
  return value;
}

export function parseSafeEnrollmentBackfillArgs(
  argv: string[],
  cwd: string
): SafeEnrollmentBackfillCliOptions {
  let apply = false;
  let verify = false;
  let rollback = false;
  const options: Omit<SafeEnrollmentBackfillCliOptions, 'mode' | 'applyRollback'> = {
    reportDir: path.resolve(cwd, 'scratch', 'safe-student-enrollment-backfill'),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--verify') verify = true;
    else if (arg === '--rollback') rollback = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--report-dir') {
      options.reportDir = path.resolve(cwd, optionValue(argv, index, arg));
      index += 1;
    } else if (arg === '--reviewed-plan') {
      options.reviewedPlanPath = path.resolve(cwd, optionValue(argv, index, arg));
      index += 1;
    } else if (arg === '--confirm-digest') {
      options.confirmDigest = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--confirm-project') {
      options.confirmProjectId = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--confirm-database') {
      options.confirmDatabaseId = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--apply-journal') {
      options.applyJournalPath = path.resolve(cwd, optionValue(argv, index, arg));
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (verify && (apply || rollback)) throw new Error('SAFE_ENROLLMENT_MODE_CONFLICT');
  const mode: SafeEnrollmentBackfillMode = rollback
    ? 'rollback'
    : verify
      ? 'verify'
      : apply
        ? 'apply'
        : 'dry-run';
  return { mode, applyRollback: rollback && apply, ...options };
}

const defaultDependencies: SafeEnrollmentRunnerDependencies = {
  loadSources: loadSafeEnrollmentSources,
  writeReports: writeSafeEnrollmentReports,
  readReviewed: readReviewedSafeEnrollmentPlan,
  preflight: preflightSafeEnrollmentApply,
  apply: applySafeEnrollmentBackfill,
  verify: verifySafeEnrollmentApply,
  appendJournal: appendCreatedEnrollmentJournal,
  readJournal: readApplyJournal,
  loadDurableJournal: loadSafeEnrollmentDurableJournal,
  planRollback: planSafeEnrollmentRollback,
  applyRollback: applySafeEnrollmentRollback,
  verifyRollback: verifySafeEnrollmentRollback,
};

function requireReviewedOptions(
  options: SafeEnrollmentBackfillCliOptions
): asserts options is SafeEnrollmentBackfillCliOptions & {
  reviewedPlanPath: string;
  confirmDigest: string;
} {
  if (!options.reviewedPlanPath || !options.confirmDigest) {
    throw new Error('SAFE_ENROLLMENT_REVIEWED_PLAN_REQUIRED');
  }
}

function requireTargetConfirmation(input: {
  options: SafeEnrollmentBackfillCliOptions;
  projectId: string;
  databaseId: string;
}): void {
  if (!input.options.confirmProjectId || !input.options.confirmDatabaseId) {
    throw new Error('SAFE_ENROLLMENT_CONFIRMATION_REQUIRED');
  }
  if (
    input.options.confirmProjectId !== input.projectId ||
    input.options.confirmDatabaseId !== input.databaseId
  ) {
    throw new Error('SAFE_ENROLLMENT_TARGET_MISMATCH');
  }
}

export async function runSafeEnrollmentBackfill(input: {
  db: DocumentStore;
  projectId: string;
  databaseId: string;
  generatedAt: string;
  vietnamDate: string;
  options: SafeEnrollmentBackfillCliOptions;
  deps?: SafeEnrollmentRunnerDependencies;
}): Promise<Record<string, unknown>> {
  const deps = input.deps || defaultDependencies;
  const target = { projectId: input.projectId, databaseId: input.databaseId };

  if (input.options.mode === 'dry-run') {
    const loaded = await deps.loadSources(input.db);
    const plan = planSafeStudentEnrollmentBackfill({
      ...loaded.sources,
      generatedAt: input.generatedAt,
      vietnamDate: input.vietnamDate,
    });
    assertSafeEnrollmentPlan(plan);
    const manifest = await deps.writeReports({
      plan,
      target,
      reportDir: input.options.reportDir,
    });
    return { mode: 'dry-run', sourceCounts: loaded.summary, plan: plan.summary, manifest };
  }

  if (input.options.mode === 'apply') {
    requireTargetConfirmation(input);
    requireReviewedOptions(input.options);
    if (
      path.resolve(input.options.reportDir) ===
      path.dirname(path.resolve(input.options.reviewedPlanPath))
    ) {
      throw new Error('SAFE_ENROLLMENT_APPLY_REPORT_DIR_MUST_DIFFER');
    }
  }
  if (input.options.mode !== 'apply') requireReviewedOptions(input.options);
  if (input.options.mode === 'rollback') {
    if (input.options.applyRollback) requireTargetConfirmation(input);
  }

  const reviewed = await deps.readReviewed({
    planPath: input.options.reviewedPlanPath,
    confirmDigest: input.options.confirmDigest,
    expectedProjectId: input.projectId,
    expectedDatabaseId: input.databaseId,
    currentVietnamDate: input.vietnamDate,
    enforceCurrentDate: input.options.mode === 'apply',
  });

  if (input.options.mode === 'verify') {
    const verification = await deps.verify({ db: input.db, reviewed });
    if (!verification.valid) throw new Error('SAFE_ENROLLMENT_VERIFY_FAILED');
    return { mode: 'verify', verification };
  }

  if (input.options.mode === 'rollback') {
    const journal = await deps.loadDurableJournal({ db: input.db, reviewed });
    if (input.options.applyJournalPath) {
      const localJournal = await deps.readJournal(input.options.applyJournalPath, {
        migrationId: reviewed.plan.migrationId,
        digest: reviewed.digest,
        target: reviewed.target,
      });
      if (canonicalJson(localJournal) !== canonicalJson(journal)) {
        throw new Error('SAFE_ENROLLMENT_LOCAL_JOURNAL_MISMATCH');
      }
    }
    const rollbackPlan = await deps.planRollback({ db: input.db, reviewed, journal });
    if (!input.options.applyRollback) return { mode: 'rollback-dry-run', rollbackPlan };
    if (rollbackPlan.blocked.length > 0) throw new Error('SAFE_ENROLLMENT_ROLLBACK_BLOCKED');
    const rollback = await deps.applyRollback({
      db: input.db,
      reviewed,
      journal,
      rollbackPlan,
    });
    if (
      rollback.conflicted !== 0 ||
      rollback.deleted !== rollbackPlan.safeToDelete.length ||
      rollback.deletedDocumentIds.length !== rollbackPlan.safeToDelete.length
    ) {
      throw new Error('SAFE_ENROLLMENT_ROLLBACK_INCOMPLETE');
    }
    const rollbackVerification = await deps.verifyRollback({ db: input.db, journal });
    if (!rollbackVerification.valid) throw new Error('SAFE_ENROLLMENT_ROLLBACK_VERIFY_FAILED');
    return { mode: 'rollback-apply', rollbackPlan, rollback, rollbackVerification };
  }

  const freshPlan = await deps.preflight({
    db: input.db,
    reviewed,
    currentVietnamDate: input.vietnamDate,
  });
  const manifest = await deps.writeReports({
    plan: freshPlan,
    target,
    reportDir: input.options.reportDir,
  });
  if (manifest.digest !== reviewed.digest) throw new Error('SAFE_ENROLLMENT_REVIEWED_PLAN_CHANGED');
  const apply = await deps.apply({
    db: input.db,
    reviewed,
    onCreated: (entry) =>
      deps.appendJournal({
        journalPath: manifest.journalPath,
        entry,
        binding: {
          migrationId: reviewed.plan.migrationId,
          digest: reviewed.digest,
          target: reviewed.target,
        },
      }),
  });
  if (
    apply.conflicted !== 0 ||
    apply.created !== freshPlan.summary.create ||
    apply.createdDocumentIds.length !== freshPlan.summary.create ||
    apply.journalSyncFailedDocumentIds.length !== 0
  ) {
    throw new Error('SAFE_ENROLLMENT_APPLY_INCOMPLETE');
  }
  const verification = await deps.verify({ db: input.db, reviewed });
  if (!verification.valid) throw new Error('SAFE_ENROLLMENT_VERIFY_FAILED');
  return { mode: 'apply', manifest, apply, verification };
}

function loadLocalEnv(): void {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function initializeFirebaseAdmin(): { app: App; projectId: string } {
  const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const servicePath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    const serviceAccount = JSON.parse(readFileSync(servicePath, 'utf8')) as ServiceAccount & {
      project_id?: string;
    };
    const projectId = String(serviceAccount.project_id || '').trim();
    if (!projectId) throw new Error('Service account has no project_id');
    const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount), projectId });
    return { app, projectId };
  }
  const projectId = requiredEnv('FIREBASE_PROJECT_ID');
  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert({
        projectId,
        clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
        privateKey: requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
      projectId,
    });
  return { app, projectId };
}

async function main(): Promise<void> {
  const options = parseSafeEnrollmentBackfillArgs(process.argv.slice(2), process.cwd());
  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }
  loadLocalEnv();
  const databaseId = requiredEnv('FIRESTORE_DATABASE_ID');
  const { app, projectId } = initializeFirebaseAdmin();
  const result = await runSafeEnrollmentBackfill({
    db: getDocumentStore(app, databaseId),
    projectId,
    databaseId,
    generatedAt: new Date().toISOString(),
    vietnamDate: getVietnamTodayStr(),
    options,
  });
  console.log(JSON.stringify({ projectId, databaseId, ...result }, null, 2));
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
