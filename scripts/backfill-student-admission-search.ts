import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  planAdmissionSearchBackfill,
  type AdmissionSearchBackfillPlan,
} from './student-profile-normalization/admissionSearchBackfill.js';

/**
 * Phase 0's only write.
 *
 * Additive and idempotent: it derives `admissionSearch*` from the profile's own
 * `name`, `dob`, and `contact` using the same normalizers the admissions path
 * uses, and writes them where they are absent. Nothing about identity,
 * relationships, or money changes, so this runs under normal operations without
 * the maintenance window.
 *
 * Repairing a stale value is a separate opt-in, because that overwrites
 * existing data rather than adding to it.
 */

const BATCH_LIMIT = 400;
const KNOWN_FLAGS = new Set(['--apply', '--repair-drift']);

export type AdmissionSearchBackfillOptions = { apply: boolean; repairDrift: boolean };

export type AdmissionSearchBackfillResult = {
  plan: AdmissionSearchBackfillPlan;
  applied: number;
  skippedDrift: number;
  coverageComplete: boolean;
};

export function parseAdmissionSearchBackfillArgs(argv: string[]): AdmissionSearchBackfillOptions {
  for (const arg of argv) {
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) {
      throw new Error(`ADMISSION_SEARCH_BACKFILL_UNKNOWN_FLAG:${arg}`);
    }
  }
  const apply = argv.includes('--apply');
  const repairDrift = argv.includes('--repair-drift');
  if (repairDrift && !apply) {
    throw new Error('ADMISSION_SEARCH_BACKFILL_REPAIR_REQUIRES_APPLY');
  }
  return { apply, repairDrift };
}

export async function runAdmissionSearchBackfill(
  options: AdmissionSearchBackfillOptions,
  dependencies: { db: DocumentStore }
): Promise<AdmissionSearchBackfillResult> {
  const { db } = dependencies;
  const snapshot = await db.collection('students').get();
  const refsById = new Map(snapshot.docs.map((doc) => [doc.id, doc.ref]));

  const plan = planAdmissionSearchBackfill(
    snapshot.docs.map((doc) => ({ id: doc.id, data: (doc.data() || {}) as Record<string, unknown> }))
  );

  const writable = plan.rows.filter(
    (row) => row.state === 'missing_fields' || (row.state === 'drifted' && options.repairDrift)
  );
  const skippedDrift = options.repairDrift
    ? 0
    : plan.rows.filter((row) => row.state === 'drifted').length;

  let applied = 0;
  if (options.apply && writable.length > 0) {
    for (let index = 0; index < writable.length; index += BATCH_LIMIT) {
      const chunk = writable.slice(index, index + BATCH_LIMIT);
      const batch = db.batch();
      for (const row of chunk) {
        const ref = refsById.get(row.profileId);
        if (!ref) throw new Error(`ADMISSION_SEARCH_BACKFILL_MISSING_REF:${row.profileId}`);
        batch.update(ref, row.patch);
      }
      await batch.commit();
      applied += chunk.length;
    }
  }

  // Complete means the guard's index has no blind spot left after this run.
  // A stale value blinds it exactly as an absent one does, so unrepaired drift
  // counts against completeness even though writing it was not requested.
  const unresolvedMissing = options.apply ? 0 : plan.counts.missing_fields;
  const unresolvedDrift = options.apply && options.repairDrift ? 0 : plan.counts.drifted;

  return {
    plan,
    applied,
    skippedDrift,
    coverageComplete:
      unresolvedMissing === 0 && unresolvedDrift === 0 && plan.counts.incomplete_source === 0,
  };
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
  const options = parseAdmissionSearchBackfillArgs(process.argv.slice(2));
  const app = initFirebase(projectRoot);
  const db = getDocumentStore(app, resolveDatabaseId(projectRoot));

  const result = await runAdmissionSearchBackfill(options, { db });

  console.log(
    JSON.stringify(
      {
        dryRun: !options.apply,
        repairDrift: options.repairDrift,
        scanned: result.plan.scanned,
        counts: result.plan.counts,
        applied: result.applied,
        skippedDrift: result.skippedDrift,
        residualCoverageGap: result.plan.residualCoverageGapProfileIds.length,
        coverageComplete: result.coverageComplete,
      },
      null,
      2
    )
  );

  if (!options.apply) {
    console.log('\nDry run. Re-run with --apply to write the additive fields.');
  }
  if (result.skippedDrift > 0) {
    console.log(
      `\n${result.skippedDrift} profile(s) hold a stale denormalized value. Add --repair-drift to recompute them.`
    );
  }
  if (result.plan.residualCoverageGapProfileIds.length > 0) {
    console.log(
      `\n${result.plan.residualCoverageGapProfileIds.length} profile(s) lack name/dob/contact and cannot be backfilled. Record them as a named baseline exclusion; the creation guard can never match them on all three fields.`
    );
  }
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
