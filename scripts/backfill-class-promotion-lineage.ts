import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { Timestamp, getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Cohorts that were promoted during the 2026-05-19 bulk setup. Their source classes are
 * no longer in the system: roster overlap is zero against every class (studentIds were
 * rewritten by standardize-student-ids on 2026-05-20), and the named sources either do
 * not exist or now hold a different cohort.
 *
 * This records the lineage for humans ONLY. It deliberately does NOT write
 * `importSourceClassId`/`promotedAt`: those drive the payroll cutoff, and a 2026-05-19
 * cutoff would wipe out every session these teachers have been paid for since.
 * See classPromotion.test.ts for the regression test that keeps the two apart.
 */
const LINEAGE: Array<{
  classId: string;
  expectedName: string;
  sourceClassName: string;
  sourceTeacherName: string;
}> = [
  {
    classId: 'pAKl7xpSLd1atr3eRofo',
    expectedName: 'Advanced 6 - Mr. Anh Tuan T3-T5',
    sourceClassName: 'G5 - Mr. Anh Tuan',
    sourceTeacherName: 'TRAN ANH TUAN',
  },
  {
    classId: 'YEGhVcj27boYOrEf2iSE',
    expectedName: 'G9 - Mr. Anh Tuan T7-CN  15H45',
    sourceClassName: 'G8 - Mr. Anh Tuan',
    sourceTeacherName: 'TRAN ANH TUAN',
  },
  {
    classId: 'htDI41OT3fXxmNWfnknT',
    expectedName: 'Advanced 9 T7-CN. 15H45',
    sourceClassName: 'Advanced 8',
    sourceTeacherName: 'Mrs. Hương',
  },
];

const LINEAGE_NOTE =
  'Ghi nhận thủ công theo xác nhận của quản lý. Lớp nguồn không còn trong hệ thống ' +
  '(studentId đã bị ghi đè bởi đợt chuẩn hoá 2026-05-20). Chỉ dùng để tra cứu lịch sử, ' +
  'KHÔNG dùng để tính lương hay điểm danh.';

export type LineageBackfillSummary = {
  mode: 'dry-run' | 'apply';
  wouldUpdate: number;
  updated: number;
  alreadyRecorded: number;
  missingClass: number;
  nameMismatch: number;
};

export async function backfillClassPromotionLineage({
  db,
  apply,
  log = console.log,
}: {
  db: Pick<DocumentStore, 'collection'>;
  apply: boolean;
  log?: (message: string) => void;
}): Promise<LineageBackfillSummary> {
  const summary: LineageBackfillSummary = {
    mode: apply ? 'apply' : 'dry-run',
    wouldUpdate: 0,
    updated: 0,
    alreadyRecorded: 0,
    missingClass: 0,
    nameMismatch: 0,
  };

  for (const entry of LINEAGE) {
    const ref = db.collection('classes').doc(entry.classId);
    const snap = await ref.get();
    if (!snap.exists) {
      summary.missingClass += 1;
      log(`[skip] ${entry.classId} không tồn tại`);
      continue;
    }

    const data = snap.data() || {};
    if (String(data.name || '') !== entry.expectedName) {
      summary.nameMismatch += 1;
      log(`[STOP] tên đã đổi — mong đợi "${entry.expectedName}", thực tế "${data.name}"`);
      continue;
    }

    // Never touch a class that carries a real payroll link.
    if (data.importSourceClassId || data.promotedAt) {
      summary.nameMismatch += 1;
      log(`[STOP] ${data.name} đã có liên kết tính lương — không ghi đè bằng lineage`);
      continue;
    }

    if (data.promotionLineage) {
      summary.alreadyRecorded += 1;
      log(`[ok] ${data.name} đã có lineage`);
      continue;
    }

    summary.wouldUpdate += 1;
    log(`[fix] ${data.name} (${entry.classId})  <- lineage "${entry.sourceClassName}" (${entry.sourceTeacherName})`);
    if (apply) {
      await ref.update({
        promotionLineage: {
          sourceClassName: entry.sourceClassName,
          sourceTeacherName: entry.sourceTeacherName,
          note: LINEAGE_NOTE,
          recordedAt: Timestamp.now(),
        },
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
  await backfillClassPromotionLineage({
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
