import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanStudentIdentityArchitecture,
  type StudentIdentityArchitecturePolicy,
} from './student-identity-architecture.js';
import { STUDENT_IDENTITY_ARCHITECTURE_ALLOWLIST } from './student-identity-architecture-allowlist.js';

/**
 * The CI gate.
 *
 * Scans application code *and* every DocumentStore-writing script. Migration
 * scripts are not blanket-ignored: they are where the most dangerous writes
 * live, and "it is a script" is exactly the reasoning that let clone-based
 * promotion ship.
 *
 * Tests and fixtures are excluded by exact path classification rather than by
 * a name heuristic. A file called `somethingTest.ts` is production code, and a
 * heuristic that skips it is a hole in the gate.
 */

// `fileURLToPath`, not `URL.pathname`: this repository's directory name
// contains a space, which the raw pathname percent-encodes into a path that
// does not exist — and the scan then reports a clean repository because it
// read nothing at all.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_ROOTS = ['server', 'api', 'src', 'shared', 'scripts'];

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.worktrees',
  '.claude',
  'coverage',
  'scratch',
]);

/** Exact suffixes that make a file a test or a fixture, never a heuristic. */
const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.test.mts', '.test.mjs', '.spec.ts', '.spec.tsx'];

function isSourceFile(filePath: string): boolean {
  if (!/\.(ts|tsx)$/.test(filePath)) return false;
  if (filePath.endsWith('.d.ts')) return false;
  if (TEST_SUFFIXES.some((suffix) => filePath.endsWith(suffix))) return false;
  if (filePath.includes(`${path.sep}test-utils${path.sep}`)) return false;
  if (filePath.includes(`${path.sep}__fixtures__${path.sep}`)) return false;
  return true;
}

function collect(directory: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = path.join(directory, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collect(full, out);
    else if (isSourceFile(full)) out.push(full);
  }
}

export function collectScannedFiles(root = ROOT): Array<{ path: string; source: string }> {
  const files: string[] = [];
  for (const scanRoot of SCAN_ROOTS) collect(path.join(root, scanRoot), files);
  return files
    .map((full) => ({
      path: path.relative(root, full).split(path.sep).join('/'),
      source: readFileSync(full, 'utf8'),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Exported so runbook parity can ask this script, like every other one it
 * names, whether it accepts the command line the runbook types.
 */
export function parsePolicy(argv: readonly string[]): StudentIdentityArchitecturePolicy {
  const index = argv.indexOf('--policy');
  if (index === -1) return 'pre-cutover';
  const value = argv[index + 1];
  if (value !== 'pre-cutover' && value !== 'post-retirement') {
    throw new Error(`Invalid --policy: ${value} (expected pre-cutover, post-retirement)`);
  }
  return value;
}

export function runStudentIdentityArchitectureCheck(argv: readonly string[], root = ROOT) {
  const policy = parsePolicy(argv);
  const violations = scanStudentIdentityArchitecture({
    policy,
    files: collectScannedFiles(root),
    allowlist: STUDENT_IDENTITY_ARCHITECTURE_ALLOWLIST,
  });
  return { policy, violations };
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('check-student-identity-architecture.ts');

if (invokedDirectly) {
  const { policy, violations } = runStudentIdentityArchitectureCheck(process.argv.slice(2));
  if (violations.length === 0) {
    console.log(`student identity architecture: clean under ${policy}`);
    process.exit(0);
  }
  for (const violation of violations) {
    // Path, line, and fingerprint together: the first two find it, the third
    // is what an allowlist entry would have to carry.
    console.error(
      `${violation.path}:${violation.line} ${violation.code} [${violation.nodeKind} ${violation.astFingerprint}] ${violation.detail}`
    );
  }
  console.error(`\n${violations.length} violation(s) under ${policy}`);
  process.exit(1);
}
