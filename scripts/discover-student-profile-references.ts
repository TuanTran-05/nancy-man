import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile as writeFileAsync } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  collectFinanceAnomalyBaseline,
  collectStudentProfileCensus,
  type FinanceAnomalyBaseline,
  type StudentProfileCensus,
} from './student-profile-normalization/census.js';
import {
  discoverStudentReferences,
  type StudentReferenceDiscovery,
} from './student-profile-normalization/discovery.js';

/**
 * Phase 0 discovery CLI. Read-only by construction: it opens DocumentStore, reads,
 * and writes JSON to a local directory the operator names explicitly.
 *
 * Its output is the input to the typed reference registry, the frozen baseline,
 * and the `admissionSearch*` backfill sizing. Nothing downstream should be
 * drafted before this has run against production.
 */

const WRITE_IMPLYING_FLAGS = new Set(['--apply', '--write', '--commit', '--force']);
const KNOWN_FLAGS = new Set(['--output-dir', '--candidate-id']);

export type StudentProfileDiscoveryOptions = {
  outputDir: string;
  explicitCandidateIds: string[];
};

export type StudentProfileDiscoveryDependencies = {
  db: DocumentStore;
  writeFile: (filePath: string, contents: string) => Promise<void>;
  now: Date;
  sourceCommitSha: string;
};

export type StudentProfileDiscoveryResult = {
  candidateProfileIds: string[];
  census: StudentProfileCensus;
  financeBaseline: FinanceAnomalyBaseline;
  discovery: StudentReferenceDiscovery;
};

export function parseStudentProfileDiscoveryArgs(
  argv: string[]
): StudentProfileDiscoveryOptions {
  let outputDir = '';
  const explicitCandidateIds = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) continue;
    if (WRITE_IMPLYING_FLAGS.has(flag)) {
      throw new Error('STUDENT_PROFILE_DISCOVERY_IS_READ_ONLY');
    }
    if (!KNOWN_FLAGS.has(flag)) {
      throw new Error(`STUDENT_PROFILE_DISCOVERY_UNKNOWN_FLAG:${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`STUDENT_PROFILE_DISCOVERY_FLAG_NEEDS_VALUE:${flag}`);
    }
    if (flag === '--output-dir') outputDir = value;
    else explicitCandidateIds.add(value);
    index += 1;
  }

  if (!outputDir) throw new Error('STUDENT_PROFILE_DISCOVERY_OUTPUT_DIR_REQUIRED');

  return {
    outputDir,
    explicitCandidateIds: [...explicitCandidateIds].sort((left, right) =>
      left.localeCompare(right)
    ),
  };
}

export async function runStudentProfileDiscovery(
  options: StudentProfileDiscoveryOptions,
  dependencies: StudentProfileDiscoveryDependencies
): Promise<StudentProfileDiscoveryResult> {
  const { db, writeFile, now, sourceCommitSha } = dependencies;

  const [census, financeBaseline] = await Promise.all([
    collectStudentProfileCensus(db),
    collectFinanceAnomalyBaseline(db),
  ]);

  const candidateProfileIds = options.explicitCandidateIds.length
    ? options.explicitCandidateIds
    : census.legacySoftMerges.map((row) => row.legacyProfileId);

  const discovery = await discoverStudentReferences({ db, candidateProfileIds });

  const generatedAt = now.toISOString();
  const emit = async (fileName: string, payload: unknown) => {
    await writeFile(
      `${options.outputDir}/${fileName}`,
      `${JSON.stringify(payload, null, 2)}\n`
    );
  };

  await emit('student-profile-census.json', { generatedAt, sourceCommitSha, census });
  await emit('student-profile-finance-baseline.json', {
    generatedAt,
    sourceCommitSha,
    financeBaseline,
  });
  await emit('student-profile-reference-inventory.json', {
    generatedAt,
    sourceCommitSha,
    candidateProfileIds,
    discovery,
  });
  await emit('student-profile-discovery-summary.json', {
    generatedAt,
    sourceCommitSha,
    readOnly: true,
    candidateProfileCount: candidateProfileIds.length,
    physicalProfiles: census.physicalProfiles,
    canonicalProfiles: census.canonicalProfiles,
    tombstones: census.tombstones,
    aliasDocuments: census.aliasDocuments,
    legacySoftMerges: census.legacySoftMerges.length,
    legacySoftMergePointerStates: census.legacySoftMerges.reduce<Record<string, number>>(
      (counts, row) => ({ ...counts, [row.pointerState]: (counts[row.pointerState] || 0) + 1 }),
      {}
    ),
    missingAdmissionSearchFields: census.missingAdmissionSearchFields.total,
    orphanLedgers: financeBaseline.orphanLedgers.length,
    totalOrphanAmount: financeBaseline.totalOrphanAmount,
    collectionsScanned: discovery.collections.length,
    documentsScanned: discovery.scannedDocuments,
    documentsWithMatches: discovery.matches.length,
    collectionsWithMatches: discovery.collections
      .filter((entry) => entry.matchedDocumentCount > 0)
      .map((entry) => entry.path),
  });

  return { candidateProfileIds, census, financeBaseline, discovery };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function initFirebase(projectRoot: string) {
  if (getApps().length) return getApps()[0];
  const servicePath = path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    return initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
  }
  return initializeApp({
    credential: cert({
      projectId: requiredEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  });
}

function resolveDatabaseId(projectRoot: string): string {
  const fromEnv = process.env.FIRESTORE_DATABASE_ID?.trim();
  if (fromEnv) return fromEnv;
  const configPath = path.join(projectRoot, 'firebase-applet-config.json');
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.documentStoreDatabaseId) return String(config.documentStoreDatabaseId);
  }
  throw new Error('Missing FIRESTORE_DATABASE_ID');
}

async function main() {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const options = parseStudentProfileDiscoveryArgs(process.argv.slice(2));
  const app = initFirebase(projectRoot);
  const db = getDocumentStore(app, resolveDatabaseId(projectRoot));
  const sourceCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();

  const result = await runStudentProfileDiscovery(options, {
    db,
    writeFile: async (filePath, contents) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFileAsync(filePath, contents, 'utf8');
    },
    now: new Date(),
    sourceCommitSha,
  });

  console.log(
    JSON.stringify(
      {
        candidateProfileIds: result.candidateProfileIds.length,
        legacySoftMerges: result.census.legacySoftMerges.length,
        missingAdmissionSearchFields: result.census.missingAdmissionSearchFields.total,
        orphanLedgers: result.financeBaseline.orphanLedgers.length,
        totalOrphanAmount: result.financeBaseline.totalOrphanAmount,
        collectionsScanned: result.discovery.collections.length,
        documentsScanned: result.discovery.scannedDocuments,
        documentsWithMatches: result.discovery.matches.length,
      },
      null,
      2
    )
  );
  console.log(`\nRead-only. Reports written to ${options.outputDir}`);
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
