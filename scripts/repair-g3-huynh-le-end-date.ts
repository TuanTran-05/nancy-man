import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type ServiceAccount } from '@/server/db/documentStore.js';
import { FieldValue, getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';

export const TARGET_G3_HUYNH_LE_CLASS_ID = 'MbEjkY4bZPvUt9ykRpPu';
export const TARGET_G3_HUYNH_LE_START_DATE = '2026-05-13';
export const TARGET_G3_HUYNH_LE_BEFORE_END_DATE = '2026-07-03';
export const TARGET_G3_HUYNH_LE_AFTER_END_DATE = '2026-07-31';
export const TARGET_G3_HUYNH_LE_AUDIT_ID = 'data_repair_g3_huynh_le_2026_07_31';
export const EXPECTED_G3_HUYNH_LE_SESSION_DATES = [
  '2026-05-13',
  '2026-05-15',
  '2026-05-20',
  '2026-05-22',
  '2026-05-27',
  '2026-05-29',
  '2026-06-03',
  '2026-06-05',
  '2026-06-10',
  '2026-06-12',
  '2026-06-17',
  '2026-06-19',
  '2026-06-24',
  '2026-06-26',
  '2026-07-01',
  '2026-07-03',
  '2026-07-08',
  '2026-07-10',
  '2026-07-15',
  '2026-07-17',
  '2026-07-22',
  '2026-07-24',
  '2026-07-29',
  '2026-07-31',
] as const;

type RepairClassSource = {
  id: string;
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  daysOfWeek?: unknown;
};

export function planG3HuynhLeEndDateRepair(input: {
  classData: RepairClassSource;
  sessionDates: readonly string[];
}): { decision: 'update' | 'noop'; before: string; after: '2026-07-31' } {
  const sortedSessions = [...input.sessionDates].sort();
  const expectedSessions = [...EXPECTED_G3_HUYNH_LE_SESSION_DATES].sort();
  const validEndDate =
    input.classData.endDate === TARGET_G3_HUYNH_LE_BEFORE_END_DATE ||
    input.classData.endDate === TARGET_G3_HUYNH_LE_AFTER_END_DATE;
  if (
    input.classData.id !== TARGET_G3_HUYNH_LE_CLASS_ID ||
    input.classData.name !== 'G3 - Huynh Le T4-T6' ||
    input.classData.startDate !== TARGET_G3_HUYNH_LE_START_DATE ||
    JSON.stringify(input.classData.daysOfWeek) !== JSON.stringify([3, 5]) ||
    !validEndDate ||
    JSON.stringify(sortedSessions) !== JSON.stringify(expectedSessions)
  ) {
    throw new Error('G3_HUYNH_LE_REPAIR_PRECONDITION_FAILED');
  }
  const before = String(input.classData.endDate);
  return {
    decision: before === TARGET_G3_HUYNH_LE_AFTER_END_DATE ? 'noop' : 'update',
    before,
    after: TARGET_G3_HUYNH_LE_AFTER_END_DATE,
  };
}

async function loadRepairSource(db: DocumentStore) {
  const classRef = db.collection('classes').doc(TARGET_G3_HUYNH_LE_CLASS_ID);
  const sessionsQuery = db
    .collection('class_sessions')
    .where('classId', '==', TARGET_G3_HUYNH_LE_CLASS_ID);
  const [classSnapshot, sessionsSnapshot] = await Promise.all([
    classRef.get(),
    sessionsQuery.get(),
  ]);
  if (!classSnapshot.exists) throw new Error('G3_HUYNH_LE_CLASS_NOT_FOUND');
  return {
    classData: { id: classSnapshot.id, ...(classSnapshot.data() || {}) },
    sessionDates: sessionsSnapshot.docs.map((doc) => String(doc.data().date || '')).sort(),
  };
}

export async function applyG3HuynhLeEndDateRepair(db: DocumentStore) {
  const repairedAt = new Date().toISOString();
  let applied = false;
  await db.runTransaction(async (transaction) => {
    const classRef = db.collection('classes').doc(TARGET_G3_HUYNH_LE_CLASS_ID);
    const auditRef = db.collection('audit_logs').doc(TARGET_G3_HUYNH_LE_AUDIT_ID);
    const sessionsQuery = db
      .collection('class_sessions')
      .where('classId', '==', TARGET_G3_HUYNH_LE_CLASS_ID);
    const [classSnapshot, sessionsSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(classRef),
      transaction.get(sessionsQuery),
      transaction.get(auditRef),
    ]);
    if (!classSnapshot.exists) throw new Error('G3_HUYNH_LE_CLASS_NOT_FOUND');
    const plan = planG3HuynhLeEndDateRepair({
      classData: { id: classSnapshot.id, ...(classSnapshot.data() || {}) },
      sessionDates: sessionsSnapshot.docs.map((doc) => String(doc.data().date || '')).sort(),
    });
    if (plan.decision === 'noop') {
      if (!auditSnapshot.exists) throw new Error('G3_HUYNH_LE_REPAIR_AUDIT_MISSING');
      return;
    }
    if (auditSnapshot.exists) throw new Error('G3_HUYNH_LE_REPAIR_AUDIT_CONFLICT');
    transaction.update(classRef, {
      endDate: TARGET_G3_HUYNH_LE_AFTER_END_DATE,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      userId: 'codex-data-repair',
      userRole: 'system',
      userName: 'Codex data repair',
      action: 'update',
      collection: 'classes',
      documentId: TARGET_G3_HUYNH_LE_CLASS_ID,
      changes: {
        endDate: {
          before: TARGET_G3_HUYNH_LE_BEFORE_END_DATE,
          after: TARGET_G3_HUYNH_LE_AFTER_END_DATE,
        },
      },
      metadata: {
        event: 'grandfathered_24_session_course_end_date_repair',
        evidenceSessionCount: EXPECTED_G3_HUYNH_LE_SESSION_DATES.length,
        futureCourseSessionCount: 16,
        sourceHolidayAuditTimestamp: '2026-07-31T10:41:41.799Z',
      },
      timestamp: repairedAt,
    });
    applied = true;
  });
  const verified = await loadRepairSource(db);
  const verification = planG3HuynhLeEndDateRepair(verified);
  if (verification.decision !== 'noop') throw new Error('G3_HUYNH_LE_REPAIR_VERIFY_FAILED');
  return { applied, verification, sessionCount: verified.sessionDates.length };
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseArgs(argv: string[]) {
  let apply = false;
  let confirmClass = '';
  let confirmBefore = '';
  let confirmAfter = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--confirm-class') {
      confirmClass = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--confirm-before') {
      confirmBefore = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--confirm-after') {
      confirmAfter = optionValue(argv, index, arg);
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return { apply, confirmClass, confirmBefore, confirmAfter };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const serviceAccountPath = path.join(projectRoot, 'service-account-key.json');
  if (!existsSync(serviceAccountPath)) throw new Error('Missing service-account-key.json');
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as ServiceAccount & {
    project_id?: string;
  };
  const projectId = String(serviceAccount.project_id || '').trim();
  const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
  if (!projectId || !databaseId) throw new Error('Missing Firebase target configuration');
  const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount), projectId });
  const db = getDocumentStore(app, databaseId);
  const source = await loadRepairSource(db);
  const plan = planG3HuynhLeEndDateRepair(source);
  if (!options.apply) {
    console.log(
      JSON.stringify(
        { mode: 'dry-run', projectId, databaseId, plan, sessionCount: source.sessionDates.length },
        null,
        2
      )
    );
    return;
  }
  if (
    options.confirmClass !== TARGET_G3_HUYNH_LE_CLASS_ID ||
    options.confirmBefore !== TARGET_G3_HUYNH_LE_BEFORE_END_DATE ||
    options.confirmAfter !== TARGET_G3_HUYNH_LE_AFTER_END_DATE
  ) {
    throw new Error('G3_HUYNH_LE_REPAIR_CONFIRMATION_MISMATCH');
  }
  const result = await applyG3HuynhLeEndDateRepair(db);
  console.log(JSON.stringify({ mode: 'apply', projectId, databaseId, ...result }, null, 2));
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
