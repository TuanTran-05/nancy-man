import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, type App } from '@/server/db/documentStore.js';
import {
  FieldPath,
  getDocumentStore,
  type DocumentData,
  type DocumentStore,
  type Query,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from '@/server/db/documentStore.js';
import { formatStudentDisplayName } from '../shared/studentRecords.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type UppercaseStudentNamesRecord = {
  id: string;
  data: Record<string, unknown>;
};

export type UppercaseStudentNamesOperation = {
  studentDocId: string;
  before: string;
  after: string;
};

export type UppercaseStudentNamesPlan = {
  scannedStudents: number;
  unchangedCount: number;
  operations: UppercaseStudentNamesOperation[];
};

export function planUppercaseStudentNames(
  students: UppercaseStudentNamesRecord[]
): UppercaseStudentNamesPlan {
  const operations: UppercaseStudentNamesOperation[] = [];
  let unchangedCount = 0;

  for (const student of students) {
    const before = String(student.data.name || '');
    const after = formatStudentDisplayName(before);
    if (after && after !== before) {
      operations.push({ studentDocId: student.id, before, after });
    } else {
      unchangedCount += 1;
    }
  }

  return { scannedStudents: students.length, unchangedCount, operations };
}

async function readAllDocuments(query: Query<DocumentData>, pageSize = 500) {
  const documents: QueryDocumentSnapshot<DocumentData>[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;

  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    documents.push(...snapshot.docs);
    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }

  return documents;
}

export async function uppercaseStudentNames({
  db,
  apply,
  maxBatchWrites = 400,
  log = console.log,
}: {
  db: DocumentStore;
  apply: boolean;
  maxBatchWrites?: number;
  log?: (message: string) => void;
}) {
  if (!Number.isInteger(maxBatchWrites) || maxBatchWrites < 1 || maxBatchWrites > 400) {
    throw new Error('maxBatchWrites must be an integer between 1 and 400');
  }

  const studentDocs = await readAllDocuments(db.collection('students'));
  const plan = planUppercaseStudentNames(studentDocs.map((doc) => ({ id: doc.id, data: doc.data() })));

  if (apply) {
    let batch: WriteBatch = db.batch();
    let batchWrites = 0;

    const flush = async () => {
      if (batchWrites === 0) return;
      await batch.commit();
      batch = db.batch();
      batchWrites = 0;
    };

    for (const operation of plan.operations) {
      batch.update(db.collection('students').doc(operation.studentDocId), {
        name: operation.after,
      });
      batchWrites += 1;
      if (batchWrites >= maxBatchWrites) await flush();

      // Linked student-role user doc mirrors the roster name as `displayName`
      // (see buildLinkedStudentUserPatch); keep it in sync so login/profile
      // screens for the student account show the same uppercase name.
      const studentUserRef = db.collection('users').doc(`student:${operation.studentDocId}`);
      const studentUserSnap = await studentUserRef.get();
      if (studentUserSnap.exists && studentUserSnap.data()?.displayName === operation.before) {
        batch.update(studentUserRef, { displayName: operation.after });
        batchWrites += 1;
        if (batchWrites >= maxBatchWrites) await flush();
      }
    }
    await flush();
  }

  log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        scannedStudents: plan.scannedStudents,
        unchangedCount: plan.unchangedCount,
        toUpdateCount: plan.operations.length,
        operations: process.argv.includes('--verbose') ? plan.operations : undefined,
      },
      null,
      2
    )
  );
  return plan;
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

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
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
      privateKey: normalizePrivateKey(requiredEnv('FIREBASE_PRIVATE_KEY')),
    }),
  });
}

async function main() {
  loadLocalEnv();
  const app = initFirebase();
  await uppercaseStudentNames({
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
