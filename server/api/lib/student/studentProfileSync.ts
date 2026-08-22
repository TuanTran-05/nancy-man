import {
  FieldValue,
  type DocumentReference,
  type DocumentStore,
  type Transaction,
} from '@/server/db/documentStore.js';

export type LinkedStudentUserRole = 'student' | 'parent';

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nullableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === '') return null;
  return value;
}

function copyIfPresent(
  patch: Record<string, unknown>,
  studentData: Record<string, unknown>,
  key: string
) {
  if (hasOwn(studentData, key)) patch[key] = nullableValue(studentData[key]);
}

export function buildLinkedStudentUserPatch(
  role: LinkedStudentUserRole,
  studentDocId: string,
  studentData: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    studentId: studentDocId,
    updatedAt: studentData.updatedAt || FieldValue.serverTimestamp(),
  };

  copyIfPresent(patch, studentData, 'classId');
  copyIfPresent(patch, studentData, 'teacherId');
  copyIfPresent(patch, studentData, 'enrollmentStatus');
  copyIfPresent(patch, studentData, 'isRevoked');

  if (role === 'student') {
    if (typeof studentData.name === 'string' && studentData.name.trim()) {
      patch.displayName = studentData.name.trim();
    }
    copyIfPresent(patch, studentData, 'faceImage');
    copyIfPresent(patch, studentData, 'faceImageStoragePath');
    if (hasOwn(studentData, 'forcePasswordChange')) {
      patch.forcePasswordChange = Boolean(studentData.forcePasswordChange);
    }
  } else if (hasOwn(studentData, 'parentForcePasswordChange')) {
    patch.forcePasswordChange = Boolean(studentData.parentForcePasswordChange);
  }

  return patch;
}

export type LinkedStudentUserPreloadEntry = {
  role: LinkedStudentUserRole;
  ref: DocumentReference;
  exists: boolean;
};

export async function readStudentLinkedUsersInTransaction(
  tx: Transaction,
  db: DocumentStore,
  studentDocId: string
): Promise<LinkedStudentUserPreloadEntry[]> {
  const users = db.collection('users');
  const linkedUsers = [
    { role: 'student' as const, ref: users.doc(`student:${studentDocId}`) },
    { role: 'parent' as const, ref: users.doc(`parent:${studentDocId}`) },
  ];
  const snapshots = await Promise.all(linkedUsers.map(({ ref }) => tx.get(ref)));

  return linkedUsers.map(({ role, ref }, index) => ({
    role,
    ref,
    exists: snapshots[index].exists,
  }));
}

export function applyStudentLinkedUsersInTransaction(
  tx: Transaction,
  studentDocId: string,
  studentData: Record<string, unknown>,
  preload: ReadonlyArray<LinkedStudentUserPreloadEntry>
): void {
  for (const { role, ref, exists } of preload) {
    if (!exists) continue;
    tx.update(ref, buildLinkedStudentUserPatch(role, studentDocId, studentData));
  }
}

export async function syncStudentLinkedUsersInTransaction(
  tx: Transaction,
  db: DocumentStore,
  studentDocId: string,
  studentData: Record<string, unknown>
): Promise<void> {
  const preload = await readStudentLinkedUsersInTransaction(tx, db, studentDocId);
  applyStudentLinkedUsersInTransaction(tx, studentDocId, studentData, preload);
}
