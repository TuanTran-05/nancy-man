import type { DocumentStore } from '@/server/db/documentStore.js';
import { FieldValue } from '@/server/db/documentStore.js';
import {
  runStudentIdentityMutationTransaction,
  type StudentIdentityMutationContext,
} from '../maintenance/studentIdentityMutationTransaction.js';

const COLLECTION = 'student_auth_credentials';

const CREDENTIAL_FIELDS = [
  'loginPasswordSalt',
  'loginPasswordHash',
  'passwordVersion',
  'parentPasswordSalt',
  'parentPasswordHash',
  'parentPasswordVersion',
] as const;

export interface StudentCredentialDoc {
  loginPasswordSalt?: string;
  loginPasswordHash?: string;
  passwordVersion?: number;
  parentPasswordSalt?: string;
  parentPasswordHash?: string;
  parentPasswordVersion?: number;
  updatedAt?: string;
}

function extractCreds(data: Record<string, unknown>): StudentCredentialDoc {
  const creds: StudentCredentialDoc = {};
  if (data.loginPasswordSalt !== undefined)
    creds.loginPasswordSalt = data.loginPasswordSalt as string;
  if (data.loginPasswordHash !== undefined)
    creds.loginPasswordHash = data.loginPasswordHash as string;
  if (data.passwordVersion !== undefined) creds.passwordVersion = data.passwordVersion as number;
  if (data.parentPasswordSalt !== undefined)
    creds.parentPasswordSalt = data.parentPasswordSalt as string;
  if (data.parentPasswordHash !== undefined)
    creds.parentPasswordHash = data.parentPasswordHash as string;
  if (data.parentPasswordVersion !== undefined)
    creds.parentPasswordVersion = data.parentPasswordVersion as number;
  return creds;
}

function hasAnyCredential(data: Record<string, unknown>): boolean {
  return CREDENTIAL_FIELDS.some((k) => data[k] != null);
}

function buildDeleteFields(): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of CREDENTIAL_FIELDS) {
    fields[field] = FieldValue.delete();
  }
  return fields;
}

/**
 * Read credential fields for a student from the server-only collection.
 * If not found, atomically migrates from students doc in a single transaction
 * (read legacy -> write student_auth_credentials -> delete legacy fields).
 */
export type StudentCredentialVerificationRead = {
  credentials: StudentCredentialDoc;
  requiresMigration: boolean;
};

/** Read credentials without mutating either credential store. */
export async function readStudentCredentialsForVerification(
  db: DocumentStore,
  studentId: string,
  knownStudentData?: Record<string, unknown>
): Promise<StudentCredentialVerificationRead> {
  const credSnap = await db.collection(COLLECTION).doc(studentId).get();
  if (credSnap.exists) {
    return {
      credentials: credSnap.data() as StudentCredentialDoc,
      requiresMigration: knownStudentData ? hasAnyCredential(knownStudentData) : false,
    };
  }

  const studentData =
    knownStudentData ??
    (((await db.collection('students').doc(studentId).get()).data() || {}) as Record<
      string,
      unknown
    >);
  return {
    credentials: extractCreds(studentData),
    requiresMigration: hasAnyCredential(studentData),
  };
}

export async function getStudentCredentials(
  db: DocumentStore,
  studentId: string,
  context: StudentIdentityMutationContext
): Promise<StudentCredentialDoc> {
  // Fast path: already migrated
  const credSnap = await db.collection(COLLECTION).doc(studentId).get();
  if (credSnap.exists) {
    // Retry-safe scrub: if leftover fields still exist, clean them up
    await scrubLeftoverFields(db, studentId, context);
    return credSnap.data() as StudentCredentialDoc;
  }

  // Atomic migration: read legacy, write new, delete legacy — all in one transaction
  const creds = await migrateStudentCredentialsAtomic(db, studentId, context);
  return creds;
}

/**
 * Atomically migrate one student's credentials:
 * tx.get(students) -> tx.set(student_auth_credentials) -> tx.update(students, delete fields)
 * If student_auth_credentials already exists, only scrubs leftover fields.
 */
async function migrateStudentCredentialsAtomic(
  db: DocumentStore,
  studentId: string,
  context: StudentIdentityMutationContext
): Promise<StudentCredentialDoc> {
  const studentRef = db.collection('students').doc(studentId);
  const credRef = db.collection(COLLECTION).doc(studentId);

  return runStudentIdentityMutationTransaction(db, context, async (tx) => {
    const [studentSnap, credSnap] = await Promise.all([tx.get(studentRef), tx.get(credRef)]);

    // Already migrated in a concurrent call — return existing
    if (credSnap.exists) {
      // Still scrub any leftover fields from students doc
      if (studentSnap.exists && hasAnyCredential(studentSnap.data() || {})) {
        tx.update(studentRef, buildDeleteFields());
      }
      return credSnap.data() as StudentCredentialDoc;
    }

    if (!studentSnap.exists) return {} as StudentCredentialDoc;

    const studentData = studentSnap.data() || {};
    const creds = extractCreds(studentData);

    if (hasAnyCredential(studentData)) {
      // Atomic: write to new collection AND delete legacy fields in same commit
      tx.set(credRef, { ...creds, migratedAt: FieldValue.serverTimestamp() });
      tx.update(studentRef, buildDeleteFields());
      console.log(`[Credentials] Auto-migrated and scrubbed student ${studentId}`);
    }

    return creds;
  });
}

export async function migrateStudentCredentialsAfterAuthentication(
  db: DocumentStore,
  studentId: string,
  context: StudentIdentityMutationContext
): Promise<StudentCredentialDoc> {
  return migrateStudentCredentialsAtomic(db, studentId, context);
}

/**
 * Retry-safe scrub: if credential fields still exist in students doc, remove them.
 * Uses a transaction to read-then-delete atomically.
 */
async function scrubLeftoverFields(
  db: DocumentStore,
  studentId: string,
  context: StudentIdentityMutationContext
): Promise<void> {
  const studentRef = db.collection('students').doc(studentId);
  try {
    await runStudentIdentityMutationTransaction(db, context, async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists) return;
      if (!hasAnyCredential(snap.data() || {})) return;
      tx.update(studentRef, buildDeleteFields());
    });
  } catch (err) {
    console.error(`[Credentials] Scrub failed for ${studentId}:`, err);
  }
}

/**
 * Write credential fields to the server-only collection.
 */
export async function setStudentCredentials(
  db: DocumentStore,
  studentId: string,
  credentials: Partial<StudentCredentialDoc>
): Promise<void> {
  await db
    .collection(COLLECTION)
    .doc(studentId)
    .set({ ...credentials, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/**
 * Bulk-migrate all students that still have credential fields in the students collection.
 * Uses atomic transactions per student. Intended for one-time pre-production run.
 * Returns counts for reporting.
 */
export async function bulkMigrateCredentials(
  db: DocumentStore,
  context: StudentIdentityMutationContext,
  batchSize = 100
): Promise<{ migrated: number; scrubbed: number; skipped: number; errors: number }> {
  let migrated = 0;
  let scrubbed = 0;
  let skipped = 0;
  let errors = 0;
  let lastDoc: AppDocumentStore.QueryDocumentSnapshot | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = db.collection('students').orderBy('__name__').limit(batchSize);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;
    lastDoc = snap.docs[snap.docs.length - 1];

    for (const doc of snap.docs) {
      const data = doc.data();
      if (!hasAnyCredential(data)) {
        skipped++;
        continue;
      }

      try {
        const studentRef = db.collection('students').doc(doc.id);
        const credRef = db.collection(COLLECTION).doc(doc.id);

        const result = await runStudentIdentityMutationTransaction(db, context, async (tx) => {
          const [studentSnap, credSnap] = await Promise.all([tx.get(studentRef), tx.get(credRef)]);

          if (!studentSnap.exists) return { didMigrate: false, didScrub: false };
          const studentData = studentSnap.data() || {};
          if (!hasAnyCredential(studentData)) return { didMigrate: false, didScrub: false };

          let didMigrate = false;
          if (!credSnap.exists) {
            const creds = extractCreds(studentData);
            tx.set(credRef, { ...creds, migratedAt: new Date().toISOString() });
            didMigrate = true;
          }

          tx.update(studentRef, buildDeleteFields());
          return { didMigrate, didScrub: true };
        });

        if (result.didMigrate) migrated++;
        if (result.didScrub) scrubbed++;
      } catch (err) {
        console.error(`[Credentials] Bulk migration error for ${doc.id}:`, err);
        errors++;
      }
    }

    if (snap.size < batchSize) break;
  }

  return { migrated, scrubbed, skipped, errors };
}

export async function verifyNoLegacyStudentCredentials(
  db: DocumentStore,
  batchSize = 100
): Promise<{ scanned: number; legacyDocuments: number; safeToEnableDirectStudentReads: boolean }> {
  let scanned = 0;
  let legacyDocuments = 0;
  let lastDoc: AppDocumentStore.QueryDocumentSnapshot | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = db.collection('students').orderBy('__name__').limit(batchSize);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;

    lastDoc = snap.docs[snap.docs.length - 1];
    for (const doc of snap.docs) {
      scanned++;
      if (hasAnyCredential(doc.data())) legacyDocuments++;
    }

    if (snap.size < batchSize) break;
  }

  return {
    scanned,
    legacyDocuments,
    safeToEnableDirectStudentReads: legacyDocuments === 0,
  };
}
