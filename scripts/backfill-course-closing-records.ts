import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  loadCourseClosingBackfillSources,
  type BackfillSourceLoadSummary,
} from './course-closing-record-backfill/documentStoreSources.js';
import { planCourseClosingRecordBackfill } from './course-closing-record-backfill/planner.js';
import {
  readReviewedBackfillPlan,
  writeBackfillReports,
  type BackfillReportManifest,
} from './course-closing-record-backfill/reporter.js';
import type {
  BackfillRunPlan,
  BackfillSourceBundle,
} from './course-closing-record-backfill/types.js';
import {
  applyCourseClosingBackfill,
  type BackfillApplySummary,
} from './course-closing-record-backfill/writer.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP_TEXT = `
backfill-course-closing-records

Usage:
  npm run audit:course-closing-records
  npm run repair:course-closing-records -- --apply \\
    --confirm-project <id> --confirm-database <id> \\
    --reviewed-plan <path> --confirm-digest <sha256> \\
    --report-dir <new-output-directory>

Flags:
  --apply                   Enable guarded writes. Dry-run is the default.
  --confirm-project <id>    Required exact Firebase project ID for apply.
  --confirm-database <id>   Required exact DocumentStore database ID for apply.
  --reviewed-plan <path>    Saved plan from the reviewed dry-run.
  --confirm-digest <sha256> Exact digest printed by the reviewed dry-run.
  --report-dir <path>       JSON/CSV output directory.
  --help                    Print this help without connecting to DocumentStore.

This command never sends Zalo, modifies source collections, creates outbox
jobs, or materializes DOCX.
`;

export interface CourseClosingBackfillCliOptions {
  apply: boolean;
  reportDir: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
  reviewedPlanPath?: string;
  confirmDigest?: string;
  help: boolean;
}

interface RunnerDependencies {
  loadSources: (db: DocumentStore) => Promise<{
    sources: BackfillSourceBundle;
    summary: BackfillSourceLoadSummary;
  }>;
  plan: (sources: BackfillSourceBundle, generatedAt: string) => BackfillRunPlan;
  writeReports: typeof writeBackfillReports;
  readReviewed: typeof readReviewedBackfillPlan;
  apply: typeof applyCourseClosingBackfill;
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

export function parseCourseClosingBackfillArgs(
  argv: string[],
  cwd: string
): CourseClosingBackfillCliOptions {
  const options: CourseClosingBackfillCliOptions = {
    apply: false,
    reportDir: path.resolve(cwd, 'scratch', 'course-closing-record-backfill'),
    confirmProjectId: undefined,
    confirmDatabaseId: undefined,
    reviewedPlanPath: undefined,
    confirmDigest: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--help') {
      options.help = true;
    } else if (arg === '--report-dir') {
      options.reportDir = path.resolve(cwd, optionValue(argv, index, arg));
      index += 1;
    } else if (arg === '--confirm-project') {
      options.confirmProjectId = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--confirm-database') {
      options.confirmDatabaseId = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--reviewed-plan') {
      options.reviewedPlanPath = path.resolve(cwd, optionValue(argv, index, arg));
      index += 1;
    } else if (arg === '--confirm-digest') {
      options.confirmDigest = optionValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

const defaultDependencies: RunnerDependencies = {
  loadSources: loadCourseClosingBackfillSources,
  plan: planCourseClosingRecordBackfill,
  writeReports: writeBackfillReports,
  readReviewed: readReviewedBackfillPlan,
  apply: applyCourseClosingBackfill,
};

export async function runCourseClosingRecordBackfill(input: {
  db: DocumentStore;
  projectId: string;
  databaseId: string;
  options: CourseClosingBackfillCliOptions;
  generatedAt: string;
  deps?: RunnerDependencies;
}): Promise<{
  manifest: BackfillReportManifest;
  applySummary?: BackfillApplySummary;
}> {
  const deps = input.deps || defaultDependencies;
  if (input.options.apply && (!input.options.reviewedPlanPath || !input.options.confirmDigest)) {
    throw new Error('BACKFILL_REVIEWED_PLAN_REQUIRED');
  }
  if (
    input.options.apply &&
    path.resolve(input.options.reportDir) ===
      path.dirname(path.resolve(input.options.reviewedPlanPath!))
  ) {
    throw new Error('BACKFILL_APPLY_REPORT_DIR_MUST_DIFFER');
  }
  const reviewed = input.options.apply
    ? await deps.readReviewed({
        planPath: input.options.reviewedPlanPath || '',
        confirmDigest: input.options.confirmDigest || '',
        expectedProjectId: input.projectId,
        expectedDatabaseId: input.databaseId,
      })
    : undefined;
  const { sources, summary: sourceCounts } = await deps.loadSources(input.db);
  const plan = deps.plan(sources, reviewed?.plan.generatedAt || input.generatedAt);
  const manifest = await deps.writeReports({
    plan,
    sourceCounts,
    target: {
      projectId: input.projectId,
      databaseId: input.databaseId,
    },
    reportDir: input.options.reportDir,
  });
  if (!input.options.apply) return { manifest };
  if (!reviewed || manifest.digest !== reviewed.digest) {
    throw new Error('BACKFILL_REVIEWED_PLAN_CHANGED');
  }

  const applySummary = await deps.apply(input.db, plan, {
    actualProjectId: input.projectId,
    actualDatabaseId: input.databaseId,
    confirmProjectId: input.options.confirmProjectId || '',
    confirmDatabaseId: input.options.confirmDatabaseId || '',
    reviewedDigest: reviewed.digest,
  });
  return { manifest, applySummary };
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
  const configuredServicePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const servicePath = configuredServicePath
    ? path.resolve(configuredServicePath)
    : path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    const serviceAccount = JSON.parse(readFileSync(servicePath, 'utf8')) as ServiceAccount & {
      project_id?: string;
    };
    const projectId = String(serviceAccount.project_id || '').trim();
    if (!projectId) throw new Error('Service account has no project_id');
    const app =
      getApps()[0] ||
      initializeApp({
        credential: cert(serviceAccount),
        projectId,
      });
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
  const options = parseCourseClosingBackfillArgs(process.argv.slice(2), process.cwd());
  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }

  loadLocalEnv();
  const databaseId = requiredEnv('FIRESTORE_DATABASE_ID');
  const { app, projectId } = initializeFirebaseAdmin();
  const result = await runCourseClosingRecordBackfill({
    db: getDocumentStore(app, databaseId),
    projectId,
    databaseId,
    options,
    generatedAt: new Date().toISOString(),
  });

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        projectId,
        databaseId,
        digest: result.manifest.digest,
        sourceCounts: result.manifest.sourceCounts,
        decisions: result.manifest.summary,
        jsonReport: result.manifest.jsonPath,
        csvReport: result.manifest.csvPath,
        planReport: result.manifest.planPath,
        ...(result.applySummary ? { apply: result.applySummary } : {}),
      },
      null,
      2
    )
  );
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
