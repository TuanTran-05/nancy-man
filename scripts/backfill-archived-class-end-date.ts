import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type ArchivedClassEndDateSummary = {
  mode: 'dry-run' | 'apply';
  scanned: number;
  archived: number;
  wouldUpdate: number;
  updated: number;
  missingArchivedAt: number;
  alreadyBounded: number;
};

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const date =
    typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Archived classes keep the endDate they had while running, so their schedule keeps
 * projecting sessions into weeks after the course actually stopped. This pulls endDate
 * back to the archive date for classes archived before their endDate.
 *
 * Classes with no archivedAt recorded cannot be corrected automatically and are
 * reported for manual review instead.
 */
export async function backfillArchivedClassEndDate({
  db,
  apply,
  log = console.log,
}: {
  db: Pick<DocumentStore, 'collection'>;
  apply: boolean;
  log?: (message: string) => void;
}): Promise<ArchivedClassEndDateSummary> {
  const summary: ArchivedClassEndDateSummary = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: 0,
    archived: 0,
    wouldUpdate: 0,
    updated: 0,
    missingArchivedAt: 0,
    alreadyBounded: 0,
  };

  const snapshot = await db.collection('classes').get();
  summary.scanned = snapshot.size;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    if (String(data.status || 'active') !== 'archived') continue;
    summary.archived += 1;

    const name = String(data.name || doc.id);
    const endDate = typeof data.endDate === 'string' ? data.endDate : '';
    const archivedOn = toIsoDate(data.archivedAt);

    if (!archivedOn) {
      summary.missingArchivedAt += 1;
      log(`[manual] ${name} (${doc.id}) endDate=${endDate || '(none)'} — no archivedAt recorded`);
      continue;
    }
    if (!endDate || endDate <= archivedOn) {
      summary.alreadyBounded += 1;
      continue;
    }

    summary.wouldUpdate += 1;
    log(`[fix] ${name} (${doc.id}) endDate ${endDate} -> ${archivedOn}`);
    if (apply) {
      await doc.ref.update({ endDate: archivedOn });
      summary.updated += 1;
    }
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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function initFirebase(): App {
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

async function main() {
  loadLocalEnv();
  const app = initFirebase();
  await backfillArchivedClassEndDate({
    db: getDocumentStore(app, requiredEnv('FIRESTORE_DATABASE_ID')),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
