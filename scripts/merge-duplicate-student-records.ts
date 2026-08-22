/**
 * Merge student records that share one student code.
 *
 * A course promotion has been creating a second `students` doc instead of
 * moving the existing one, so one child ends up with a stale `promoted` record
 * pointing at the archived class plus an `active` record in the new class. Every
 * accounting list then shows the child twice and their money is split across two
 * ids.
 *
 * The script keeps one record per code, repoints every reference at it, and
 * archives the other exactly the way the student delete handler does — a soft
 * archive plus `mergedIntoStudentId`, never a hard delete, so a bad merge stays
 * reversible.
 *
 * DEPRECATED — report only. Write mode is permanently disabled.
 *
 * This script ran the 58 merges that exist in production today, and it is the
 * reason they need repairing: it moved only fourteen of the sixty-six
 * collections the server uses, wrote no `student_profile_aliases` record, and
 * retired the losing document with `mergedIntoStudentId` instead of a canonical
 * tombstone. Nothing in the application reads that field.
 *
 * Its planner is kept so its output can be compared against the replacement.
 * To merge anything, use the reviewed engine under
 * `scripts/student-profile-normalization/`.
 *
 * Usage:
 *   tsx scripts/merge-duplicate-student-records.ts                      # report
 *   tsx scripts/merge-duplicate-student-records.ts --write-manifest out.json
 *   tsx scripts/merge-duplicate-student-records.ts --code HS260167      # one code
 */
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';
import { courseClosingRecordId } from '../shared/courseClosingRecords.js';
import { buildCourseLedgerId } from '../server/api/classes/helpers/classHelpers.js';

export const MERGE_ACTOR_ID = 'merge-duplicate-student-records';

export type StudentRecord = { id: string; data: Record<string, unknown> };
export type ReferenceDoc = { id: string; data: Record<string, unknown> };

/** Collections whose docs point at a student through a plain `studentId` field. */
export const FIELD_REFERENCE_COLLECTIONS = [
  'admissions_history',
  'evaluations',
  'notifications',
  'payment_order_codes',
  'receipts',
  'submissions',
  'wallet_transactions',
  'zalo_bulk_job_items',
  'zalo_notifications',
] as const;

/**
 * Collections whose document id encodes the student id. Moving one means
 * writing a new doc and deleting the old, so a colliding target id on the keep
 * side blocks the whole group instead of silently overwriting.
 */
export const KEYED_REFERENCE_COLLECTIONS = [
  'attendance',
  'course_closing_records',
  'course_fee_ledgers',
  'student_course_enrollments',
] as const;

/** Derived docs that a rebuild regenerates; the stale ones are dropped. */
export const DERIVED_REFERENCE_COLLECTIONS = ['accounting_student_summaries'] as const;

/**
 * Login accounts are addressed by document id, not by a field: a student's own
 * account lives at `users/student:<studentId>` and the parent's at
 * `users/parent:<studentId>`, with the password at
 * `student_auth_credentials/<studentId>`. A field query alone misses an account
 * whose `studentId` was already repointed by an earlier data fix while its id
 * still carries the old student.
 */
export const LINKED_USER_PREFIXES = ['student', 'parent'] as const;

export type ReferenceBundle = {
  field: Record<string, ReferenceDoc[]>;
  keyed: Record<string, ReferenceDoc[]>;
  derived: Record<string, ReferenceDoc[]>;
  users: ReferenceDoc[];
  authCredential: ReferenceDoc | null;
};

export type PlannedMove = {
  collection: string;
  fromDocId: string;
  toDocId: string;
  kind: 'field' | 'recreate' | 'drop';
};

export type MergeGroupPlan = {
  code: string;
  name: string;
  keepId: string;
  keepReasons: string[];
  mergeIds: string[];
  blockers: string[];
  mergeable: boolean;
  moves: PlannedMove[];
  walletTransfer: {
    fromStudentId: string;
    walletBalance: number;
    walletOpeningBalance: number;
    walletHistoryStartedAt: string | null;
  } | null;
};

export type MergePlan = {
  groups: MergeGroupPlan[];
  mergeableGroups: number;
  blockedGroups: number;
  scannedStudents: number;
  duplicateCodes: number;
};

export type MergeSummary = {
  dryRun: boolean;
  /**
   * Always true. This script's plan shape predates the canonical model — it
   * knows fourteen collections, writes no aliases, and retires a document with
   * `mergedIntoStudentId` rather than a tombstone. Callers comparing its output
   * to the normalization engine's must not treat the two as equivalent.
   */
  deprecated: true;
  scannedStudents: number;
  duplicateCodes: number;
  mergeableGroups: number;
  blockedGroups: number;
  mergedGroups: number;
  movedDocs: number;
  droppedDocs: number;
  archivedStudents: number;
  blockers: Record<string, number>;
  backupPath: string | null;
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function studentCode(data: Record<string, unknown>): string {
  return str(data.studentId) || str(data.code);
}

/** Vietnamese names differ in case and spacing across imports; compare loosely. */
export function normalizeName(value: unknown): string {
  return str(value).toLocaleLowerCase('vi').replace(/\s+/g, ' ');
}

export function isArchivedRecord(data: Record<string, unknown>): boolean {
  return (
    data.isRevoked === true ||
    Boolean(data.deletedAt) ||
    str(data.studentLifecycle) === 'archived' ||
    str(data.mergedIntoStudentId) !== ''
  );
}

function timeOf(data: Record<string, unknown>): number {
  for (const key of ['updatedAt', 'statusChangedAt', 'createdAt']) {
    const raw = data[key];
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (raw && typeof raw === 'object') {
      const seconds =
        (raw as { _seconds?: number; seconds?: number })._seconds ??
        (raw as { seconds?: number }).seconds;
      if (typeof seconds === 'number') return seconds * 1000;
    }
  }
  return 0;
}

/**
 * Keep the record the school is actually teaching: the one sitting in a class
 * that has not been archived. Everything after that is a tie-break so the same
 * input always produces the same plan.
 */
export function chooseKeepRecord(
  records: StudentRecord[],
  classStatusById: Map<string, string>
): { keepId: string; reasons: string[] } {
  const scored = records.map((record) => {
    const classId = str(record.data.classId);
    const classStatus = classId ? classStatusById.get(classId) : undefined;
    const reasons: string[] = [];
    let score = 0;
    if (classStatus && classStatus !== 'archived') {
      score += 1000;
      reasons.push('đang ở lớp còn hoạt động');
    }
    if (str(record.data.enrollmentStatus) === 'active') {
      score += 100;
      reasons.push('enrollmentStatus=active');
    }
    if (!isArchivedRecord(record.data)) {
      score += 10;
      reasons.push('chưa bị lưu trữ');
    }
    return { record, score, reasons, time: timeOf(record.data) };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.time !== a.time) return b.time - a.time;
    return a.record.id.localeCompare(b.record.id);
  });

  const winner = scored[0];
  const reasons = winner.reasons.length ? winner.reasons : ['bản ghi mới nhất'];
  return { keepId: winner.record.id, reasons };
}

/** Target document id for a keyed reference once it belongs to `keepId`. */
export function keyedTargetDocId(
  collection: string,
  doc: ReferenceDoc,
  keepId: string
): string | null {
  const data = doc.data;
  const classId = str(data.classId);
  switch (collection) {
    case 'attendance': {
      const date = str(data.date);
      if (!classId || !date) return null;
      return `${classId}_${keepId}_${date}`;
    }
    case 'course_fee_ledgers': {
      if (!classId) return null;
      return buildCourseLedgerId(keepId, classId, str(data.termStart), str(data.termEnd));
    }
    case 'student_course_enrollments': {
      const termStart = str(data.termStart);
      if (!classId || !termStart) return null;
      return makeStudentCourseEnrollmentId(keepId, classId, termStart);
    }
    case 'course_closing_records': {
      const courseId = str(data.courseId) || str(data.classId);
      if (!courseId) return null;
      return courseClosingRecordId(courseId, keepId);
    }
    default:
      return null;
  }
}

export function planMergeGroup(input: {
  code: string;
  records: StudentRecord[];
  classStatusById: Map<string, string>;
  referencesByStudentId: Map<string, ReferenceBundle>;
  existingKeyedIds: Map<string, Set<string>>;
}): MergeGroupPlan {
  const { code, records, classStatusById, referencesByStudentId, existingKeyedIds } = input;
  const { keepId, reasons } = chooseKeepRecord(records, classStatusById);
  const keep = records.find((record) => record.id === keepId)!;
  const mergeRecords = records.filter((record) => record.id !== keepId);
  const blockers: string[] = [];
  const moves: PlannedMove[] = [];

  const names = new Set(records.map((record) => normalizeName(record.data.name)));
  if (names.size > 1) blockers.push('tên khác nhau giữa các bản ghi');
  if (records.length > 2) blockers.push('nhiều hơn hai bản ghi cùng mã');

  const keepWallet = money(keep.data.walletBalance);
  const keepUsers = referencesByStudentId.get(keepId)?.users || [];
  let walletTransfer: MergeGroupPlan['walletTransfer'] = null;

  for (const record of mergeRecords) {
    const bundle = referencesByStudentId.get(record.id);
    if (!bundle) continue;

    const wallet = money(record.data.walletBalance);
    const opening = money(record.data.walletOpeningBalance);
    if (wallet !== 0 || opening !== 0) {
      if (keepWallet !== 0 || money(keep.data.walletOpeningBalance) !== 0) {
        blockers.push('cả hai bản ghi đều có số dư ví');
      } else if (walletTransfer) {
        blockers.push('nhiều bản ghi cùng có số dư ví');
      } else {
        walletTransfer = {
          fromStudentId: record.id,
          walletBalance: wallet,
          walletOpeningBalance: opening,
          walletHistoryStartedAt: str(record.data.walletHistoryStartedAt) || null,
        };
      }
    }

    const keepUserIds = new Set(keepUsers.map((user) => user.id));
    const sharesRole = bundle.users.some((user) => {
      const prefix = LINKED_USER_PREFIXES.find((role) => user.id.startsWith(`${role}:`));
      return prefix
        ? keepUserIds.has(`${prefix}:${keepId}`)
        : keepUsers.some((existing) => !existing.id.includes(':'));
    });
    if (sharesRole) blockers.push('cả hai bản ghi đều có tài khoản đăng nhập');

    for (const user of bundle.users) {
      const prefix = LINKED_USER_PREFIXES.find((role) => user.id === `${role}:${record.id}`);
      const targetId = prefix ? `${prefix}:${keepId}` : user.id;
      if (targetId !== user.id && keepUserIds.has(targetId)) {
        blockers.push('trùng tài khoản đăng nhập sau khi gộp');
      }
      moves.push({
        collection: 'users',
        fromDocId: user.id,
        toDocId: targetId,
        kind: targetId === user.id ? 'field' : 'recreate',
      });
    }

    if (bundle.authCredential) {
      const keepCredential = referencesByStudentId.get(keepId)?.authCredential;
      if (keepCredential) blockers.push('cả hai bản ghi đều có mật khẩu học sinh');
      else {
        moves.push({
          collection: 'student_auth_credentials',
          fromDocId: bundle.authCredential.id,
          toDocId: keepId,
          kind: 'recreate',
        });
      }
    }

    for (const collection of FIELD_REFERENCE_COLLECTIONS) {
      for (const doc of bundle.field[collection] || []) {
        moves.push({ collection, fromDocId: doc.id, toDocId: doc.id, kind: 'field' });
      }
    }

    for (const collection of KEYED_REFERENCE_COLLECTIONS) {
      for (const doc of bundle.keyed[collection] || []) {
        const targetId = keyedTargetDocId(collection, doc, keepId);
        if (!targetId) {
          blockers.push(`không dựng được id mới cho ${collection}/${doc.id}`);
          continue;
        }
        if (existingKeyedIds.get(collection)?.has(targetId)) {
          blockers.push(`${collection} đã có bản ghi trùng ở bản giữ lại`);
          continue;
        }
        moves.push({
          collection,
          fromDocId: doc.id,
          toDocId: targetId,
          kind: targetId === doc.id ? 'field' : 'recreate',
        });
      }
    }

    for (const collection of DERIVED_REFERENCE_COLLECTIONS) {
      for (const doc of bundle.derived[collection] || []) {
        moves.push({ collection, fromDocId: doc.id, toDocId: doc.id, kind: 'drop' });
      }
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    code,
    name: str(keep.data.name),
    keepId,
    keepReasons: reasons,
    mergeIds: mergeRecords.map((record) => record.id),
    blockers: uniqueBlockers,
    mergeable: uniqueBlockers.length === 0,
    moves,
    walletTransfer,
  };
}

export function buildMergePlan(input: {
  students: StudentRecord[];
  classStatusById: Map<string, string>;
  referencesByStudentId: Map<string, ReferenceBundle>;
  existingKeyedIds: Map<string, Set<string>>;
  codes?: string[];
}): MergePlan {
  const wanted = input.codes?.length ? new Set(input.codes) : null;
  const byCode = new Map<string, StudentRecord[]>();
  for (const student of input.students) {
    const code = studentCode(student.data);
    if (!code) continue;
    if (wanted && !wanted.has(code)) continue;
    byCode.set(code, [...(byCode.get(code) || []), student]);
  }

  const groups: MergeGroupPlan[] = [];
  for (const [code, records] of byCode) {
    if (records.length < 2) continue;
    groups.push(
      planMergeGroup({
        code,
        records,
        classStatusById: input.classStatusById,
        referencesByStudentId: input.referencesByStudentId,
        existingKeyedIds: input.existingKeyedIds,
      })
    );
  }
  groups.sort((a, b) => a.code.localeCompare(b.code));

  return {
    groups,
    mergeableGroups: groups.filter((group) => group.mergeable).length,
    blockedGroups: groups.filter((group) => !group.mergeable).length,
    scannedStudents: input.students.length,
    duplicateCodes: groups.length,
  };
}

async function collectReferences(db: DocumentStore, studentId: string): Promise<ReferenceBundle> {
  const bundle: ReferenceBundle = {
    field: {},
    keyed: {},
    derived: {},
    users: [],
    authCredential: null,
  };
  const read = async (collection: string) => {
    const snap = await db.collection(collection).where('studentId', '==', studentId).get();
    return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  };
  for (const collection of FIELD_REFERENCE_COLLECTIONS) {
    bundle.field[collection] = await read(collection);
  }
  for (const collection of KEYED_REFERENCE_COLLECTIONS) {
    bundle.keyed[collection] = await read(collection);
  }
  for (const collection of DERIVED_REFERENCE_COLLECTIONS) {
    bundle.derived[collection] = await read(collection);
  }
  const usersById = new Map<string, ReferenceDoc>();
  for (const user of await read('users')) usersById.set(user.id, user);
  for (const prefix of LINKED_USER_PREFIXES) {
    const docId = `${prefix}:${studentId}`;
    if (usersById.has(docId)) continue;
    const snapshot = await db.collection('users').doc(docId).get();
    if (snapshot.exists) usersById.set(docId, { id: docId, data: snapshot.data() || {} });
  }
  bundle.users = [...usersById.values()];

  const credential = await db.collection('student_auth_credentials').doc(studentId).get();
  bundle.authCredential = credential.exists
    ? { id: credential.id, data: credential.data() || {} }
    : null;
  return bundle;
}

/**
 * Flags that once selected write mode, including the aliases the CLI never
 * documented. Listed exhaustively so a forgotten synonym cannot reopen the
 * writer that this program exists to replace.
 */
const LEGACY_WRITE_MODE_FLAGS = ['--apply', '--write', '--commit', '--force', '--execute'];

/**
 * Refuses legacy write mode during argument parsing.
 *
 * Placement matters more than the check itself: `main()` initializes Firebase
 * with production write credentials before it inspects any flag, so a guard
 * further down would already have opened the connection it is meant to prevent.
 */
export function assertLegacyMergeWriteModeDisabled(argv: readonly string[]): void {
  const requested = LEGACY_WRITE_MODE_FLAGS.filter((flag) => argv.includes(flag));
  if (requested.length > 0) {
    throw new Error(
      `LEGACY_STUDENT_MERGE_DISABLED: ${requested.join(', ')} is no longer supported. ` +
        'Use the reviewed normalization engine under scripts/student-profile-normalization/.'
    );
  }
}

export async function mergeDuplicateStudentRecords(input: {
  db: DocumentStore;
  apply?: boolean;
  codes?: string[];
  writePlan?: (plan: MergePlan) => void;
}): Promise<MergeSummary> {
  const { db, apply = false } = input;
  // Before destructuring reaches any DocumentStore call. The writer moved only
  // fourteen collections, created no aliases, and left retired documents in the
  // `mergedIntoStudentId` state the normalization engine now has to repair;
  // running it again would deepen that damage.
  if (apply) {
    throw new Error(
      'LEGACY_STUDENT_MERGE_DISABLED: write mode is permanently disabled. ' +
        'Use the reviewed normalization engine under scripts/student-profile-normalization/.'
    );
  }
  const [studentsSnap, classesSnap] = await Promise.all([
    db.collection('students').get(),
    db.collection('classes').get(),
  ]);
  const students: StudentRecord[] = studentsSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {},
  }));
  const classStatusById = new Map(
    classesSnap.docs.map((doc) => [doc.id, str(doc.data()?.status) || 'active'])
  );

  // Only duplicated codes need reference reads, so the scan stays cheap.
  const byCode = new Map<string, StudentRecord[]>();
  for (const student of students) {
    const code = studentCode(student.data);
    if (!code) continue;
    if (input.codes?.length && !input.codes.includes(code)) continue;
    byCode.set(code, [...(byCode.get(code) || []), student]);
  }
  const involved = [...byCode.values()].filter((records) => records.length > 1).flat();

  const referencesByStudentId = new Map<string, ReferenceBundle>();
  for (const student of involved) {
    referencesByStudentId.set(student.id, await collectReferences(db, student.id));
  }

  const existingKeyedIds = new Map<string, Set<string>>();
  for (const collection of KEYED_REFERENCE_COLLECTIONS) {
    const ids = new Set<string>();
    for (const bundle of referencesByStudentId.values()) {
      for (const doc of bundle.keyed[collection] || []) ids.add(doc.id);
    }
    existingKeyedIds.set(collection, ids);
  }

  const plan = buildMergePlan({
    students,
    classStatusById,
    referencesByStudentId,
    existingKeyedIds,
    codes: input.codes,
  });
  input.writePlan?.(plan);

  const blockers: Record<string, number> = {};
  for (const group of plan.groups) {
    for (const blocker of group.blockers) blockers[blocker] = (blockers[blocker] || 0) + 1;
  }

  const summary: MergeSummary = {
    dryRun: !apply,
    deprecated: true,
    scannedStudents: plan.scannedStudents,
    duplicateCodes: plan.duplicateCodes,
    mergeableGroups: plan.mergeableGroups,
    blockedGroups: plan.blockedGroups,
    mergedGroups: 0,
    movedDocs: 0,
    droppedDocs: 0,
    archivedStudents: 0,
    blockers,
    backupPath: null,
  };
  // The writer that used to follow was deleted along with `applyGroup`. Leaving
  // it behind an unreachable guard would mean one deleted line could re-enable
  // a migration path this program is repairing.
  return summary;
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
  const args = process.argv.slice(2);
  assertLegacyMergeWriteModeDisabled(args);
  const valueOf = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const codes = args
    .flatMap((arg, index) => (arg === '--code' ? [args[index + 1]] : []))
    .filter(Boolean);

  const app = initFirebase(projectRoot);
  const db = getDocumentStore(app, resolveDatabaseId(projectRoot));
  const manifestPath = valueOf('--write-manifest');

  const summary = await mergeDuplicateStudentRecords({
    db,
    codes,
    writePlan: (plan) => {
      if (manifestPath) writeFileSync(manifestPath, JSON.stringify(plan, null, 2));
    },
  });
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    '\nBáo cáo tham khảo (đã ngừng hỗ trợ ghi). Script này chỉ chuyển 14 collection, ' +
      'không tạo alias, và đánh dấu hồ sơ cũ bằng mergedIntoStudentId.' +
      '\nDùng engine chuẩn hoá tại scripts/student-profile-normalization/ để gộp thật.'
  );
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
