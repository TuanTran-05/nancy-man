import { createHash } from 'node:crypto';
import type { DocumentStore } from '@/server/db/documentStore.js';
import type { StudentProfileMergeReviewedFile } from '../../../../scripts/student-profile-normalization/reporter.js';

export type HealthSourceResult<T> =
  | { ok: true; source: string; value: T; observedAt: string; sourceDigest: string }
  | { ok: false; source: string; code: 'unavailable' | 'invalid'; detail: string; observedAt: string; };

type Doc = { id: string; data: Record<string, unknown> };

export type StudentIdentityHealthSources = {
  collections: {
    students: HealthSourceResult<Doc[]>;
    aliases: HealthSourceResult<Doc[]>;
    enrollments: HealthSourceResult<Doc[]>;
    credentials: HealthSourceResult<Doc[]>;
    users: HealthSourceResult<Doc[]>;
    registry: HealthSourceResult<Doc[]>;
    summaries: HealthSourceResult<Doc[]>;
    journal: HealthSourceResult<Doc[]>;
    holds: HealthSourceResult<Doc[]>;
    leases: HealthSourceResult<Doc[]>;
    outboxJobs: HealthSourceResult<Doc[]>;
    financeOutbox: HealthSourceResult<Doc[]>;
    receiptOutbox: HealthSourceResult<Doc[]>;
    zaloJobs: HealthSourceResult<Doc[]>;
    payosProcessors: HealthSourceResult<Doc[]>;
    passwordResetWork: HealthSourceResult<Doc[]>;
    ledgers: HealthSourceResult<Doc[]>;
  };
  inventory: HealthSourceResult<unknown>;
  normalizationVerification: HealthSourceResult<StudentProfileNormalizationVerificationRecord | undefined>;
  accountingProjection: HealthSourceResult<unknown>;
  dashboard: HealthSourceResult<unknown>;
  classCounts: HealthSourceResult<unknown>;
  readControl: HealthSourceResult<unknown>;
};

export const STUDENT_PROFILE_NORMALIZATION_VERIFICATIONS =
  'student_profile_normalization_verifications';

export type StudentProfileNormalizationVerificationRecord = {
  runId: string;
  moneyMatches?: unknown;
  valid?: unknown;
  blockers?: unknown;
};

/**
 * The verification filed for a run, or an honest absence.
 *
 * A run with no verification is not a run whose money is fine; it is a run
 * nobody checked. That distinction is the whole reason this source exists
 * separately from the reviewed plan.
 */
async function readNormalizationVerification(
  db: DocumentStore,
  runId: string | undefined,
  observedAt: string,
  planDigest: string
): Promise<HealthSourceResult<StudentProfileNormalizationVerificationRecord | undefined>> {
  const source = 'normalizationVerification';
  if (!runId) {
    return { ok: true, source, value: undefined, observedAt, sourceDigest: planDigest };
  }
  try {
    const snapshot = (await db
      .doc(`${STUDENT_PROFILE_NORMALIZATION_VERIFICATIONS}/${runId}`)
      .get()) as unknown as { exists: boolean; data: () => Record<string, unknown> | undefined };
    if (!snapshot.exists) {
      return { ok: true, source, value: undefined, observedAt, sourceDigest: planDigest };
    }
    const value = (snapshot.data() ?? {}) as StudentProfileNormalizationVerificationRecord;
    return {
      ok: true,
      source,
      value,
      observedAt,
      sourceDigest: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    };
  } catch (error) {
    return {
      ok: false,
      source,
      code: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
      observedAt,
    };
  }
}

async function readCollection(db: DocumentStore, name: string, now?: Date): Promise<HealthSourceResult<Doc[]>> {
  const observedAt = (now || new Date()).toISOString();
  try {
    const snapshot = await db.collection(name).get();
    const docs = (snapshot.docs || []).map(doc => ({ id: doc.id, data: doc.data() || {} }));
    const sourceDigest = createHash('sha256').update(JSON.stringify(docs)).digest('hex');
    return { ok: true, source: `documentStore:${name}`, value: docs, observedAt, sourceDigest };
  } catch (error) {
    return { ok: false, source: `documentStore:${name}`, code: 'unavailable', detail: error instanceof Error ? error.message : String(error), observedAt };
  }
}

export async function collectStudentIdentityHealthSources(input: {
  db: DocumentStore;
  reviewedPlan?: StudentProfileMergeReviewedFile;
  /** The run whose merge-engine verification this report stands on. */
  runId?: string;
  now?: Date;
}): Promise<StudentIdentityHealthSources> {
  const [
    students,
    aliases,
    enrollments,
    credentials,
    users,
    registry,
    summaries,
    journal,
    holds,
    leases,
    outboxJobs,
    financeOutbox,
    receiptOutbox,
    zaloJobs,
    payosProcessors,
    passwordResetWork,
    ledgers,
  ] = await Promise.all([
    readCollection(input.db, 'students', input.now),
    readCollection(input.db, 'student_profile_aliases', input.now),
    readCollection(input.db, 'student_course_enrollments', input.now),
    readCollection(input.db, 'student_auth_credentials', input.now),
    readCollection(input.db, 'users', input.now),
    readCollection(input.db, 'student_code_registry', input.now),
    readCollection(input.db, 'accounting_student_summaries', input.now),
    readCollection(input.db, 'student_profile_merge_journal', input.now),
    readCollection(input.db, 'student_profile_merge_holds', input.now),
    readCollection(input.db, '_maintenance/student_identity/active_mutations', input.now),
    readCollection(input.db, 'outbox_jobs', input.now),
    readCollection(input.db, 'accounting_finance_outbox', input.now),
    readCollection(input.db, 'receipt_notification_outbox', input.now),
    readCollection(input.db, 'zalo_bulk_jobs', input.now),
    readCollection(input.db, 'payos_processors', input.now),
    readCollection(input.db, 'passwordResetRequests', input.now),
    readCollection(input.db, 'course_fee_ledgers', input.now),
  ]);

  const observedAt = (input.now || new Date()).toISOString();
  let planDigest = '';
  if (input.reviewedPlan) {
    planDigest = createHash('sha256').update(JSON.stringify(input.reviewedPlan)).digest('hex');
  }

  return {
    collections: {
      students,
      aliases,
      enrollments,
      credentials,
      users,
      registry,
      summaries,
      journal,
      holds,
      leases,
      outboxJobs,
      financeOutbox,
      receiptOutbox,
      zaloJobs,
      payosProcessors,
      passwordResetWork,
      ledgers,
    },
    inventory: { ok: true, source: 'inventory', value: {}, observedAt, sourceDigest: '' },
    // The merge engine's own verification, read by run id. A reviewed plan
    // says what was intended; only the verification says what was measured,
    // and the money invariant the release gate reads comes from the second.
    normalizationVerification: await readNormalizationVerification(
      input.db,
      input.runId,
      observedAt,
      planDigest
    ),
    accountingProjection: { ok: true, source: 'accountingProjection', value: {}, observedAt, sourceDigest: '' },
    dashboard: { ok: true, source: 'dashboard', value: {}, observedAt, sourceDigest: '' },
    classCounts: { ok: true, source: 'classCounts', value: {}, observedAt, sourceDigest: '' },
    readControl: { ok: true, source: 'readControl', value: {}, observedAt, sourceDigest: '' },
  };
}
