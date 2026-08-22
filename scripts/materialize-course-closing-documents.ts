/**
 * Renders DOCX files for archived course-closing records that were backfilled
 * without one.
 *
 * Default mode is a read-only dry run that writes a reviewable plan. `--apply`
 * additionally requires the exact project, database and plan digest printed by
 * that dry run, so a reviewed plan can never be applied to the wrong target or
 * to a plan that changed after review.
 *
 * This command never sends Zalo, never edits source collections, never creates
 * outbox jobs and never materializes a `not_requested` artifact.
 */
import { constants, existsSync, readFileSync } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import { readLocalStorageRoot } from '../server/api/lib/storage/config.js';
import { getObjectStore } from '../server/api/lib/storage/objectStore.js';
import { loadCourseClosingMaterializationSources } from './course-closing-materialization/documentStoreSources.js';
import { planCourseClosingMaterialization } from './course-closing-materialization/planner.js';
import {
  readReviewedMaterializationPlan,
  writeMaterializationReports,
  writeMaterializationRunSummary,
  type MaterializationReportManifest,
} from './course-closing-materialization/reporter.js';
import { applyCourseClosingMaterialization } from './course-closing-materialization/runner.js';
import { inspectCourseClosingStorage } from './course-closing-materialization/storageSources.js';
import { verifyCourseClosingMaterialization } from './course-closing-materialization/verifier.js';
import type {
  MaterializationApplySummary,
  MaterializationVerificationSummary,
} from './course-closing-materialization/types.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP_TEXT = `
materialize-course-closing-documents

Usage:
  npm run audit:course-closing-materialization
  npm run repair:course-closing-materialization -- --apply \\
    --confirm-project <id> --confirm-database <id> \\
    --reviewed-plan <path> --confirm-digest <sha256> \\
    --report-dir <new-output-directory>

Flags:
  --apply                   Enable guarded rendering. Dry-run is the default.
  --confirm-project <id>    Required exact Firebase project ID for apply.
  --confirm-database <id>   Required exact DocumentStore database ID for apply.
  --reviewed-plan <path>    Saved plan from the reviewed dry-run.
  --confirm-digest <sha256> Exact digest printed by the reviewed dry-run.
  --report-dir <path>       JSON/CSV output directory.
  --help                    Print this help without connecting to DocumentStore.

Every course-closing document is inspected. Existing ready Storage objects are
never overwritten. Missing historical data is rendered only after the reviewed
plan explicitly marks it unavailable.
`;

export interface MaterializationCliOptions {
  apply: boolean;
  reportDir: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
  reviewedPlanPath?: string;
  confirmDigest?: string;
  help: boolean;
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

export function parseMaterializationArgs(argv: string[], cwd: string): MaterializationCliOptions {
  const options: MaterializationCliOptions = {
    apply: false,
    reportDir: path.resolve(cwd, 'scratch', 'course-closing-materialization'),
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

interface RunnerDependencies {
  loadSources: typeof loadCourseClosingMaterializationSources;
  inspectStorage: typeof inspectCourseClosingStorage;
  plan: typeof planCourseClosingMaterialization;
  writeReports: typeof writeMaterializationReports;
  readReviewed: typeof readReviewedMaterializationPlan;
  apply: typeof applyCourseClosingMaterialization;
  verify: typeof verifyCourseClosingMaterialization;
  fileExists: (storagePath: string) => Promise<boolean>;
  preflight: () => Promise<void>;
}

const defaultDependencies: RunnerDependencies = {
  loadSources: loadCourseClosingMaterializationSources,
  inspectStorage: inspectCourseClosingStorage,
  plan: planCourseClosingMaterialization,
  writeReports: writeMaterializationReports,
  readReviewed: readReviewedMaterializationPlan,
  apply: applyCourseClosingMaterialization,
  verify: verifyCourseClosingMaterialization,
  fileExists: (storagePath: string) => getObjectStore().exists(storagePath),
  // Fail before the first record write instead of burning an attempt on the
  // whole plan when the VPS storage directory is not writable.
  preflight: async () => {
    const root = readLocalStorageRoot();
    await mkdir(root, { recursive: true });
    await access(root, constants.R_OK | constants.W_OK);
  },
};

export async function runCourseClosingMaterialization(input: {
  db: DocumentStore;
  projectId: string;
  databaseId: string;
  options: MaterializationCliOptions;
  generatedAt: string;
  deps?: RunnerDependencies;
}): Promise<{
  manifest: MaterializationReportManifest;
  applySummary?: MaterializationApplySummary;
  verification?: MaterializationVerificationSummary;
}> {
  const deps = input.deps || defaultDependencies;
  const { options } = input;

  if (options.apply && (!options.reviewedPlanPath || !options.confirmDigest)) {
    throw new Error('MATERIALIZE_REVIEWED_PLAN_REQUIRED');
  }
  if (
    options.apply &&
    path.resolve(options.reportDir) === path.dirname(path.resolve(options.reviewedPlanPath!))
  ) {
    throw new Error('MATERIALIZE_APPLY_REPORT_DIR_MUST_DIFFER');
  }

  const reviewed = options.apply
    ? await deps.readReviewed({
        planPath: options.reviewedPlanPath || '',
        confirmDigest: options.confirmDigest || '',
        expectedProjectId: input.projectId,
        expectedDatabaseId: input.databaseId,
      })
    : undefined;

  const sources = await deps.loadSources(input.db);
  const storage = await deps.inspectStorage(sources.records, deps.fileExists);
  const plan = deps.plan(sources, storage, reviewed?.plan.generatedAt || input.generatedAt);
  const target = { projectId: input.projectId, databaseId: input.databaseId };
  const manifest = await deps.writeReports({ plan, target, reportDir: options.reportDir });

  if (!options.apply) return { manifest };
  if (!reviewed || manifest.digest !== reviewed.digest) {
    throw new Error('MATERIALIZE_REVIEWED_PLAN_CHANGED');
  }
  if (plan.blocked) {
    throw new Error('MATERIALIZE_PLAN_BLOCKED_BY_CONFLICT');
  }

  await deps.preflight();

  const applySummary = await deps.apply(
    input.db,
    plan,
    {
      actualProjectId: input.projectId,
      actualDatabaseId: input.databaseId,
      confirmProjectId: options.confirmProjectId || '',
      confirmDatabaseId: options.confirmDatabaseId || '',
      reviewedDigest: reviewed.digest,
    },
    { fileExists: deps.fileExists }
  );

  const verification = await deps.verify(input.db, plan, { fileExists: deps.fileExists });

  await writeMaterializationRunSummary({
    reportDir: options.reportDir,
    filename: 'course-closing-materialization-apply.json',
    payload: { digest: manifest.digest, target, apply: applySummary, verification },
  });

  return { manifest, applySummary, verification };
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
  const options = parseMaterializationArgs(process.argv.slice(2), process.cwd());
  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }

  loadLocalEnv();
  const databaseId = requiredEnv('FIRESTORE_DATABASE_ID');
  const { app, projectId } = initializeFirebaseAdmin();
  const result = await runCourseClosingMaterialization({
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
        plan: result.manifest.summary,
        jsonReport: result.manifest.jsonPath,
        csvReport: result.manifest.csvPath,
        planReport: result.manifest.planPath,
        ...(result.applySummary
          ? {
              apply: {
                materialized: result.applySummary.materialized,
                unchanged_ready: result.applySummary.unchanged_ready,
                repaired_ready_status: result.applySummary.repaired_ready_status,
                conflicted: result.applySummary.conflicted,
                failed: result.applySummary.failed,
              },
            }
          : {}),
        ...(result.verification
          ? {
              verification: {
                ready_with_file: result.verification.ready_with_file,
                metadata_missing: result.verification.metadata_missing,
                file_missing: result.verification.file_missing,
              },
            }
          : {}),
      },
      null,
      2
    )
  );

  if (
    result.verification &&
    (result.verification.ready_with_file !== result.manifest.summary.total ||
      result.verification.metadata_missing !== 0 ||
      result.verification.file_missing !== 0)
  ) {
    process.exitCode = 1;
  }
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
