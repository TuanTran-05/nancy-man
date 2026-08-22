import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  executeStudentIdentityCli,
  runStudentIdentityCliIfDirect,
  createDefaultStudentIdentityCliRuntime,
  assertConfirmedTarget,
  type StudentIdentityCliRuntime,
} from './student-identity-cli/runtime.js';
import { writeJsonArtifactThroughRuntime } from './student-identity-cli/artifacts.js';
import { rebuildStudentIdentityProjections } from '../server/api/lib/student/studentIdentityProjectionService.js';

export type RebuildStudentIdentityProjectionsOptions = {
  mode: string;
  apply: boolean;
  runId: string;
  confirmProjectId?: string;
  confirmDatabaseId?: string;
  outputPath?: string;
};

export class RebuildStudentIdentityProjectionsUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RebuildStudentIdentityProjectionsUsageError';
  }
}

const VALUE_FLAGS = new Set([
  '--mode',
  '--run-id',
  '--confirm-project-id',
  '--confirm-database-id',
  '--output',
]);

const BOOLEAN_FLAGS = new Set(['--apply']);

export function parseRebuildStudentIdentityProjectionsArgs(
  argv: readonly string[]
): RebuildStudentIdentityProjectionsOptions {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new RebuildStudentIdentityProjectionsUsageError(`Unexpected argument: ${token}`);
    }
    if (seen.has(token)) {
      throw new RebuildStudentIdentityProjectionsUsageError(`Repeated flag: ${token}`);
    }
    seen.add(token);

    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--apply') apply = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new RebuildStudentIdentityProjectionsUsageError(`Unknown flag: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new RebuildStudentIdentityProjectionsUsageError(`Missing value for ${token}`);
    }
    values.set(token, value);
    index += 1;
  }

  const mode = values.get('--mode') ?? 'default';
  const runId = values.get('--run-id');
  if (!runId) {
    throw new RebuildStudentIdentityProjectionsUsageError('--run-id is required');
  }

  const outputPath = values.get('--output');
  if (!apply && !outputPath) {
    throw new RebuildStudentIdentityProjectionsUsageError(
      '--output FILE is required for a dry run; this command never chooses a path for you'
    );
  }

  if (apply) {
    const projectId = values.get('--confirm-project-id');
    const databaseId = values.get('--confirm-database-id');
    if (!projectId || !databaseId) {
      throw new RebuildStudentIdentityProjectionsUsageError(
        '--apply requires --confirm-project-id and --confirm-database-id'
      );
    }
  }

  return {
    mode,
    apply,
    runId,
    confirmProjectId: values.get('--confirm-project-id'),
    confirmDatabaseId: values.get('--confirm-database-id'),
    outputPath,
  };
}

export const REBUILD_STUDENT_IDENTITY_PROJECTIONS_USAGE = `
Usage: npx tsx scripts/rebuild-student-identity-projections.ts [options]

Options:
  --mode <mode>                  (default: default)
  --apply                        Apply the rebuild
  --run-id <id>                  Run ID
  --confirm-project-id <id>      Project ID for apply
  --confirm-database-id <id>     Database ID for apply
  --output <path>                Path to write the report
`;

export async function rebuildStudentIdentityProjectionsCommand(
  options: RebuildStudentIdentityProjectionsOptions,
  runtime: StudentIdentityCliRuntime
): Promise<number> {
  const opened = await runtime.openDocumentStore();
  if (options.confirmProjectId || options.confirmDatabaseId) {
    assertConfirmedTarget(opened.target, {
      projectId: options.confirmProjectId,
      databaseId: options.confirmDatabaseId,
    });
  }
  return runRebuildStudentIdentityProjections(options, runtime, opened.db);
}

export async function runRebuildStudentIdentityProjections(
  options: RebuildStudentIdentityProjectionsOptions,
  runtime: StudentIdentityCliRuntime,
  db: DocumentStore
): Promise<number> {
  const result = await rebuildStudentIdentityProjections({
    db,
    apply: options.apply,
    runId: options.runId,
    now: runtime.now(),
  });

  if (options.outputPath) {
    await writeJsonArtifactThroughRuntime(options.outputPath, result, runtime);
  }

  const line = result.evidenceId
    ? `projection rebuild ${result.valid ? 'valid' : 'invalid'} evidence=${result.evidenceId}`
    : `projection rebuild ${result.valid ? 'valid' : 'invalid'} (dry run, no evidence recorded)`;
  if (typeof runtime.stdout === 'function') runtime.stdout(line);
  else runtime.stdout.write(line);

  if (!result.valid) {
    const error = new Error(`Rebuild blocked: ${result.blockers.join(', ')}`);
    (error as { usageError?: boolean }).usageError = false;
    throw error;
  }
  return 0;
}

runStudentIdentityCliIfDirect(import.meta.url, () =>
  executeStudentIdentityCli({
    argv: process.argv.slice(2),
    usage: REBUILD_STUDENT_IDENTITY_PROJECTIONS_USAGE,
    parse: parseRebuildStudentIdentityProjectionsArgs,
    run: rebuildStudentIdentityProjectionsCommand,
    runtime: createDefaultStudentIdentityCliRuntime(),
  })
);
