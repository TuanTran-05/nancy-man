import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { Timestamp, getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Classes created through "lên lớp" before the link was persisted. Derived from roster
 * overlap by report-class-promotion-links.ts and reviewed before being fixed here, so
 * the mapping is explicit rather than re-inferred at write time.
 */
const APPROVED_LINKS: Array<{
  newClassId: string;
  sourceClassId: string;
  promotedAt: string;
  expectedNewName: string;
  expectedSourceName: string;
}> = [
  {
    newClassId: 'sFc2NhcpwbmdudLCPpIp',
    sourceClassId: 'waoUqyi2aZ00NKgIcbIf',
    promotedAt: '2026-06-27T15:25:43.407Z',
    expectedNewName: 'G1 - Mr.Minh T7-CN 17H30',
    expectedSourceName: 'G1 - Mr. Minh',
  },
  {
    newClassId: 'mxZlZe2CtUrOvjYhuwvi',
    sourceClassId: 'eHaGs0lAu2GqMWW2i19N',
    promotedAt: '2026-06-27T15:33:44.376Z',
    expectedNewName: 'G2 - CS2 - Mr. Vĩ Khang',
    expectedSourceName: 'G1 - CS2',
  },
  {
    newClassId: '8gRFsTVLErsXTi2DbRyD',
    sourceClassId: 'LMpRvmwnanq28ftRLvP3',
    promotedAt: '2026-06-29T10:14:35.142Z',
    expectedNewName: 'G4 - Mr. Anh Tuan T7-CN 17H30',
    expectedSourceName: 'G3',
  },
  {
    newClassId: 'bfKk4jq9TBB9vlnB4TjH',
    sourceClassId: 'Z8oeO9IN5H3lsV6IOAoH',
    promotedAt: '2026-07-10T14:43:16.435Z',
    expectedNewName: 'G7 - Mr. Tuấn Trần T3-T5',
    expectedSourceName: 'G6',
  },
];

export type PromotionBackfillSummary = {
  mode: 'dry-run' | 'apply';
  wouldUpdate: number;
  updated: number;
  alreadyLinked: number;
  missingClass: number;
  nameMismatch: number;
};

export async function backfillClassPromotionLinks({
  db,
  apply,
  log = console.log,
}: {
  db: Pick<DocumentStore, 'collection'>;
  apply: boolean;
  log?: (message: string) => void;
}): Promise<PromotionBackfillSummary> {
  const summary: PromotionBackfillSummary = {
    mode: apply ? 'apply' : 'dry-run',
    wouldUpdate: 0,
    updated: 0,
    alreadyLinked: 0,
    missingClass: 0,
    nameMismatch: 0,
  };

  for (const link of APPROVED_LINKS) {
    const newRef = db.collection('classes').doc(link.newClassId);
    const [newSnap, sourceSnap] = await Promise.all([
      newRef.get(),
      db.collection('classes').doc(link.sourceClassId).get(),
    ]);

    if (!newSnap.exists || !sourceSnap.exists) {
      summary.missingClass += 1;
      log(`[skip] ${link.newClassId} hoặc ${link.sourceClassId} không tồn tại`);
      continue;
    }

    const newData = newSnap.data() || {};
    const sourceData = sourceSnap.data() || {};

    // Names were edited after creation, so treat a mismatch as a signal to stop
    // rather than silently linking the wrong pair.
    if (
      String(newData.name || '') !== link.expectedNewName ||
      String(sourceData.name || '') !== link.expectedSourceName
    ) {
      summary.nameMismatch += 1;
      log(
        `[STOP] tên lớp đã đổi — mong đợi "${link.expectedNewName}" <- "${link.expectedSourceName}", ` +
          `thực tế "${newData.name}" <- "${sourceData.name}"`
      );
      continue;
    }

    if (String(newData.importSourceClassId || '') === link.sourceClassId) {
      summary.alreadyLinked += 1;
      log(`[ok] ${newData.name} đã có liên kết`);
      continue;
    }

    summary.wouldUpdate += 1;
    log(
      `[fix] ${newData.name} (${link.newClassId}) <- ${sourceData.name} (${link.sourceClassId}) ` +
        `promotedAt=${link.promotedAt}`
    );
    if (apply) {
      await newRef.update({
        importSourceClassId: link.sourceClassId,
        promotedAt: Timestamp.fromDate(new Date(link.promotedAt)),
      });
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
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
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
  await backfillClassPromotionLinks({
    db: getDocumentStore(initFirebase(), requiredEnv('FIRESTORE_DATABASE_ID')),
    apply: process.argv.includes('--apply'),
  });
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
