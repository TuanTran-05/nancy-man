import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import { FieldValue, getDocumentStore } from '@/server/db/documentStore.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type StudentLifecycleAuditRecord = {
  id: string;
  enrollmentStatus?: unknown;
  studentLifecycle?: unknown;
  isRevoked?: unknown;
  deletedAt?: unknown;
  classId?: unknown;
  teacherId?: unknown;
  statusNote?: unknown;
  archiveReason?: unknown;
  [key: string]: unknown;
};

export type StudentLifecycleAuditClassification =
  | 'repairable_dropped_status'
  | 'soft_deleted'
  | 'historical_archived'
  | 'current_ok'
  | 'needs_manual_review';

export function classifyStudentLifecycleRecord(
  record: StudentLifecycleAuditRecord
): StudentLifecycleAuditClassification {
  if (record.studentLifecycle !== 'archived') return 'current_ok';
  if (record.archiveReason === 'trial_rejected') return 'historical_archived';
  if (
    String(record.statusNote || '')
      .trim()
      .toLowerCase() === 'soft deleted'
  ) {
    return 'soft_deleted';
  }
  if (
    record.enrollmentStatus === 'dropped' &&
    record.isRevoked === true &&
    record.deletedAt &&
    record.classId &&
    record.teacherId
  ) {
    return 'repairable_dropped_status';
  }
  return 'needs_manual_review';
}

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizePrivateKey(value: string): string {
  let privateKey = value;
  if (
    (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
    (privateKey.startsWith("'") && privateKey.endsWith("'"))
  ) {
    privateKey = privateKey.slice(1, -1);
  }
  return privateKey.replace(/\\n/g, '\n');
}

function initFirebase(): App {
  if (getApps().length) return getApps()[0];

  const servicePath = path.join(projectRoot, 'service-account-key.json');
  if (existsSync(servicePath)) {
    const serviceAccount = JSON.parse(readFileSync(servicePath, 'utf8'));
    return initializeApp({ credential: cert(serviceAccount) });
  }

  const projectId = requiredEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requiredEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = normalizePrivateKey(requiredEnv('FIREBASE_PRIVATE_KEY'));
  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  loadLocalEnv();
  const db = getDocumentStore(initFirebase(), requiredEnv('FIRESTORE_DATABASE_ID'));
  const snap = await db.collection('students').where('studentLifecycle', '==', 'archived').get();

  const counts: Record<StudentLifecycleAuditClassification, number> = {
    repairable_dropped_status: 0,
    soft_deleted: 0,
    historical_archived: 0,
    current_ok: 0,
    needs_manual_review: 0,
  };

  for (const doc of snap.docs) {
    const data: StudentLifecycleAuditRecord = {
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    };
    const classification = classifyStudentLifecycleRecord(data);
    counts[classification] += 1;
    console.log(
      JSON.stringify({
        id: doc.id,
        classification,
        studentId: data.studentId,
        name: data.name,
      })
    );

    if (apply && classification === 'repairable_dropped_status') {
      await doc.ref.update({
        studentLifecycle: 'enrolled',
        isRevoked: false,
        deletedAt: FieldValue.delete(),
        deletedBy: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(JSON.stringify({ apply, counts }, null, 2));
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
