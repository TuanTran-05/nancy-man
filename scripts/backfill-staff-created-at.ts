import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth, type Auth } from '@/server/api/lib/auth/nativeAdminAuth.js';
import {
  getDocumentStore,
  type DocumentStore,
  type WriteBatch,
} from '@/server/db/documentStore.js';

const STAFF_ROLES = new Set(['teacher', 'office', 'accounting']);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type StaffCreatedAtBackfillSummary = {
  mode: 'dry-run' | 'apply';
  scanned: number;
  eligible: number;
  wouldUpdate: number;
  updated: number;
  alreadySet: number;
  missingUserDoc: number;
  outOfScopeRole: number;
  missingCreationTime: number;
  errors: number;
};

export async function backfillStaffCreatedAt({
  auth,
  db,
  apply,
  maxBatchWrites = 400,
  log = console.log,
}: {
  auth: Pick<Auth, 'listUsers'>;
  db: Pick<DocumentStore, 'collection' | 'batch'>;
  apply: boolean;
  maxBatchWrites?: number;
  log?: (message: string) => void;
}): Promise<StaffCreatedAtBackfillSummary> {
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 400) {
    throw new Error('maxBatchWrites must be an integer between 1 and 400');
  }

  const summary: StaffCreatedAtBackfillSummary = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: 0,
    eligible: 0,
    wouldUpdate: 0,
    updated: 0,
    alreadySet: 0,
    missingUserDoc: 0,
    outOfScopeRole: 0,
    missingCreationTime: 0,
    errors: 0,
  };

  let pageToken: string | undefined;
  let batch: WriteBatch | null = apply ? db.batch() : null;
  let batchWrites = 0;

  const flush = async () => {
    if (!batch || batchWrites === 0) return;
    const committedWrites = batchWrites;
    await batch.commit();
    summary.updated += committedWrites;
    batch = db.batch();
    batchWrites = 0;
  };

  try {
    do {
      const page = await auth.listUsers(1000, pageToken);

      for (const authUser of page.users) {
        summary.scanned += 1;
        const userSnap = await db.collection('users').doc(authUser.uid).get();

        if (!userSnap.exists) {
          summary.missingUserDoc += 1;
          continue;
        }

        const userData = userSnap.data() || {};
        if (!STAFF_ROLES.has(String(userData.role || ''))) {
          summary.outOfScopeRole += 1;
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(userData, 'createdAt')) {
          summary.alreadySet += 1;
          continue;
        }

        const rawCreationTime = authUser.metadata.creationTime;
        const creationDate = rawCreationTime ? new Date(rawCreationTime) : null;
        if (!creationDate || Number.isNaN(creationDate.getTime())) {
          summary.missingCreationTime += 1;
          continue;
        }

        summary.eligible += 1;
        const createdAt = creationDate.toISOString();

        if (!apply) {
          summary.wouldUpdate += 1;
          continue;
        }

        const updateTime = userSnap.updateTime;
        if (!updateTime) {
          throw new Error(`Missing updateTime for users/${authUser.uid}`);
        }

        batch!.update(userSnap.ref, { createdAt }, { lastUpdateTime: updateTime });
        batchWrites += 1;
        if (batchWrites >= maxBatchWrites) await flush();
      }

      pageToken = page.pageToken;
    } while (pageToken);

    await flush();
  } catch (error) {
    summary.errors += 1;
    log(JSON.stringify(summary, null, 2));
    throw error;
  }

  log(JSON.stringify(summary, null, 2));
  return summary;
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadLocalEnv();
  await backfillStaffCreatedAt({
    auth: getAuth(),
    db: getDocumentStore(),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
