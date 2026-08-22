import type { DocumentStore, Transaction } from '@/server/db/documentStore.js';
import {
  canonicalStudentReadModeRank,
  isCanonicalStudentReadMode,
  type CanonicalStudentReadMode,
} from '../../../../shared/canonicalStudentReadModel.js';
import { readStudentIdentityMaintenanceInTransaction } from '../maintenance/studentIdentityMaintenance.js';

/**
 * The rollout switch for canonical student reads, and the one place that
 * decides whether legacy compatibility projections are still written.
 *
 * Two rules shape everything here, and both are about not moving backwards.
 *
 * The DocumentStore document is the authority, not the environment. An env var can
 * only bootstrap a mode while the document has never existed; once it does, a
 * redeploy carrying a stale `CANONICAL_STUDENT_READ_MODE` cannot roll the mode
 * back underneath a cutover that is already in progress.
 *
 * And the mode is monotonic within a process. A malformed document, an
 * unreachable DocumentStore, or a generation that went backwards all resolve to
 * the strictest mode this process has already served — because a process that
 * has been returning canonical rows cannot start returning legacy ones again
 * without the two halves of the system disagreeing about who a student is.
 */

export const STUDENT_IDENTITY_READ_MODEL_PATH = '_maintenance/student_identity_read_model';

export type CanonicalStudentReadControlRecord = {
  schemaVersion: 1;
  mode: CanonicalStudentReadMode;
  generation: number;
  activatedAt: unknown;
  activatedBy: string;
  normalizationRunId: string | null;
  planDigest: string | null;
  approvalDigest: string | null;
};

export type CanonicalStudentReadControl = CanonicalStudentReadControlRecord & {
  /** The stored document could not be parsed; the mode below is a fallback. */
  malformed: boolean;
  /** The document could not be read; the mode below is the last known one. */
  degraded: boolean;
};

export type CanonicalRequiredModeReadiness = {
  requiredModeBlockerCount: number;
  sameHumanHoldCount: number;
  unresolvedDifferentCodeCandidateCount: number;
  quarantinedProfileCount: number;
  evaluatedAt: string;
};

/**
 * The strictest mode this process has served, and the generation it came from.
 * Sticky by design — see the module comment.
 */
let observedMode: CanonicalStudentReadMode = 'legacy_compare';
let observedGeneration = 0;

export function resetCanonicalStudentReadControlCacheForTests(): void {
  observedMode = 'legacy_compare';
  observedGeneration = 0;
}

/**
 * Deployment bootstrap only, and deliberately incapable of reaching
 * `canonical_required`: that mode rejects any profile whose canonical
 * relationships are incomplete, so activating it from an environment variable
 * on a cold deploy would mean the strictest mode goes live with nobody having
 * checked the blocker count. Workstream D's audited CLI owns that transition.
 */
export function getBootstrapCanonicalStudentReadMode(
  env: NodeJS.ProcessEnv = process.env
): CanonicalStudentReadMode {
  const requested = env.CANONICAL_STUDENT_READ_MODE;
  if (!isCanonicalStudentReadMode(requested)) return 'legacy_compare';
  if (requested === 'canonical_required') return 'legacy_compare';
  return requested;
}

function parseRecord(raw: unknown): CanonicalStudentReadControlRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) return null;
  if (!isCanonicalStudentReadMode(value.mode)) return null;
  if (typeof value.generation !== 'number' || !Number.isFinite(value.generation)) return null;
  return {
    schemaVersion: 1,
    mode: value.mode,
    generation: value.generation,
    activatedAt: value.activatedAt ?? null,
    activatedBy: typeof value.activatedBy === 'string' ? value.activatedBy : '',
    normalizationRunId:
      typeof value.normalizationRunId === 'string' ? value.normalizationRunId : null,
    planDigest: typeof value.planDigest === 'string' ? value.planDigest : null,
    approvalDigest: typeof value.approvalDigest === 'string' ? value.approvalDigest : null,
  };
}

function atLeastObserved(
  mode: CanonicalStudentReadMode,
  generation: number
): { mode: CanonicalStudentReadMode; generation: number } {
  if (canonicalStudentReadModeRank(mode) >= canonicalStudentReadModeRank(observedMode)) {
    observedMode = mode;
    observedGeneration = Math.max(observedGeneration, generation);
    return { mode, generation: observedGeneration };
  }
  return { mode: observedMode, generation: observedGeneration };
}

function fallback(
  reason: 'malformed' | 'degraded' | 'bootstrap',
  mode: CanonicalStudentReadMode
): CanonicalStudentReadControl {
  const resolved = atLeastObserved(mode, observedGeneration);
  return {
    schemaVersion: 1,
    mode: resolved.mode,
    generation: reason === 'bootstrap' ? 0 : resolved.generation,
    activatedAt: null,
    activatedBy: '',
    normalizationRunId: null,
    planDigest: null,
    approvalDigest: null,
    malformed: reason === 'malformed',
    degraded: reason === 'degraded',
  };
}

export async function readCanonicalStudentReadControl(
  db: DocumentStore
): Promise<CanonicalStudentReadControl> {
  let snapshot: { exists: boolean; data: () => unknown } | undefined;
  try {
    snapshot = (await db.doc(STUDENT_IDENTITY_READ_MODEL_PATH).get()) as unknown as {
      exists: boolean;
      data: () => unknown;
    };
  } catch {
    // Unreadable control state is not evidence that the rollout was undone.
    return fallback('degraded', observedMode);
  }

  if (!snapshot?.exists) {
    return fallback('bootstrap', getBootstrapCanonicalStudentReadMode());
  }

  const record = parseRecord(snapshot.data());
  if (!record) return fallback('malformed', observedMode);

  if (record.generation < observedGeneration) {
    // A generation that went backwards means a stale replica or a bad write,
    // never a legitimate rollback.
    return {
      ...record,
      mode: observedMode,
      generation: observedGeneration,
      malformed: false,
      degraded: true,
    };
  }

  const resolved = atLeastObserved(record.mode, record.generation);
  return {
    ...record,
    mode: resolved.mode,
    generation: resolved.generation,
    malformed: false,
    degraded: resolved.mode !== record.mode,
  };
}

export async function readCanonicalStudentReadControlInTransaction(
  tx: Transaction,
  db: DocumentStore
): Promise<CanonicalStudentReadControl> {
  const snapshot = (await tx.get(db.doc(STUDENT_IDENTITY_READ_MODEL_PATH) as never)) as unknown as {
    exists: boolean;
    data: () => unknown;
  };
  
  if (!snapshot?.exists) {
    return fallback('bootstrap', getBootstrapCanonicalStudentReadMode());
  }

  const record = parseRecord(snapshot.data());
  if (!record) return fallback('malformed', observedMode);

  if (record.generation < observedGeneration) {
    return {
      ...record,
      mode: observedMode,
      generation: observedGeneration,
      malformed: false,
      degraded: true,
    };
  }

  const resolved = atLeastObserved(record.mode, record.generation);
  return {
    ...record,
    mode: resolved.mode,
    generation: resolved.generation,
    malformed: false,
    degraded: resolved.mode !== record.mode,
  };
}

/**
 * Whether `students.classId`/`teacherId`/`enrollmentStatus` are still written
 * alongside the canonical enrollment.
 *
 * They are kept through `canonical_preferred` because the UI, the DocumentStore
 * rules, and every report still read them. `canonical_required` is the point
 * at which the enrollment is the only answer, so writing them again would
 * recreate the drift the whole workstream removes.
 */
export function shouldWriteLegacyStudentProjections(mode: CanonicalStudentReadMode): boolean {
  return mode !== 'canonical_required';
}

export function assertCanonicalStudentReadModeActivatable(
  mode: CanonicalStudentReadMode,
  readiness: CanonicalRequiredModeReadiness
): void {
  // The weaker modes are how blockers get discovered in the first place;
  // gating them on a zero blocker count would be circular.
  if (mode !== 'canonical_required') return;

  const blockers = [
    ['requiredModeBlockerCount', readiness.requiredModeBlockerCount],
    ['sameHumanHoldCount', readiness.sameHumanHoldCount],
    ['unresolvedDifferentCodeCandidateCount', readiness.unresolvedDifferentCodeCandidateCount],
    ['quarantinedProfileCount', readiness.quarantinedProfileCount],
  ] as const;
  const outstanding = blockers.filter(([, count]) => Number(count) > 0);
  if (outstanding.length > 0) {
    throw Object.assign(
      new Error(
        `CANONICAL_READ_REQUIRED_MODE_BLOCKED: ${outstanding
          .map(([name, count]) => `${name}=${count}`)
          .join(', ')}`
      ),
      { statusCode: 409 }
    );
  }
}

export type CanonicalReadDiscrepancyReason =
  | 'LEGACY_PHYSICAL_DUPLICATE'
  | 'CANONICAL_ROW_MISSING'
  | 'LEGACY_ROW_MISSING'
  | 'PLACEMENT_STATUS_MISMATCH'
  | 'CLASS_PROJECTION_STALE';

export type CanonicalReadDiscrepancy = {
  surface: string;
  reasonCode: CanonicalReadDiscrepancyReason;
  canonicalProfileIds: string[];
  legacyProfileIds: string[];
  legacyCount: number;
  canonicalCount: number;
};

const DISCREPANCY_FIELDS = new Set<keyof CanonicalReadDiscrepancy>([
  'surface',
  'reasonCode',
  'canonicalProfileIds',
  'legacyProfileIds',
  'legacyCount',
  'canonicalCount',
]);

/**
 * Discrepancies are emitted in bulk during `legacy_compare`, so the allowlist
 * is enforced rather than documented. A name, a phone number, or a credential
 * fingerprint reaching a log line is a leak that no later redaction undoes,
 * and the caller passing an extra field is exactly how that happens.
 */
/**
 * Where shadow-mode findings go.
 *
 * One structured line per discrepancy rather than a counter, because the
 * question at cutover is never "how many" on its own — it is which profiles,
 * so an operator can open them. The allowlist above is what keeps that safe to
 * write down.
 */
export function recordCanonicalReadDiscrepancies(
  discrepancies: readonly CanonicalReadDiscrepancy[]
): void {
  for (const discrepancy of discrepancies) {
    console.info('[canonical-read-discrepancy]', JSON.stringify(discrepancy));
  }
}

export function buildCanonicalReadDiscrepancy(
  input: CanonicalReadDiscrepancy
): CanonicalReadDiscrepancy {
  const unexpected = Object.keys(input).filter(
    (key) => !DISCREPANCY_FIELDS.has(key as keyof CanonicalReadDiscrepancy)
  );
  if (unexpected.length > 0) {
    throw new Error(
      `CANONICAL_READ_DISCREPANCY_FIELD_FORBIDDEN: ${unexpected.sort().join(', ')}`
    );
  }
  return {
    surface: input.surface,
    reasonCode: input.reasonCode,
    canonicalProfileIds: [...input.canonicalProfileIds].sort(),
    legacyProfileIds: [...input.legacyProfileIds].sort(),
    legacyCount: input.legacyCount,
    canonicalCount: input.canonicalCount,
  };
}

/**
 * The audited transition between read modes.
 *
 * Compare-and-set on both the mode and the generation. The generation is what
 * makes a concurrent transition lose rather than silently overwrite: two
 * operators who both read `canonical_preferred` and both write
 * `canonical_required` would otherwise each believe they performed the switch,
 * and only one of them would have checked the blocker count that mattered.
 *
 * `canonical_required` additionally demands an active maintenance window bound
 * to the same run. That mode refuses any profile whose canonical relationships
 * are incomplete, so switching into it while the center is serving traffic
 * turns an ordinary read into an error for whoever is on the page.
 */
export async function transitionCanonicalStudentReadMode(
  db: DocumentStore,
  input: {
    expectedMode: CanonicalStudentReadMode;
    targetMode: CanonicalStudentReadMode;
    expectedGeneration: number;
    runId: string;
    actorId: string;
    planDigest: string;
    approvalDigest: string;
    readiness?: CanonicalRequiredModeReadiness;
  },
  now: Date = new Date()
): Promise<CanonicalStudentReadControlRecord> {
  return db.runTransaction(async (tx) => {
    const snapshot = (await tx.get(db.doc(STUDENT_IDENTITY_READ_MODEL_PATH) as never)) as unknown as {
      exists: boolean;
      data: () => unknown;
    };
    const current = snapshot.exists ? parseRecord(snapshot.data()) : null;
    const currentMode = current?.mode ?? 'legacy_compare';
    const currentGeneration = current?.generation ?? 0;

    if (currentMode !== input.expectedMode) {
      throw Object.assign(
        new Error(
          `CANONICAL_READ_MODE_UNEXPECTED: serving ${currentMode}, expected ${input.expectedMode}`
        ),
        { statusCode: 409 }
      );
    }
    if (currentGeneration !== input.expectedGeneration) {
      throw Object.assign(
        new Error(
          `CANONICAL_READ_GENERATION_UNEXPECTED: at ${currentGeneration}, expected ${input.expectedGeneration}`
        ),
        { statusCode: 409 }
      );
    }

    if (input.targetMode === 'canonical_required') {
      if (!input.readiness) {
        throw Object.assign(
          new Error('CANONICAL_READ_REQUIRED_MODE_BLOCKED: no readiness evidence supplied'),
          { statusCode: 409 }
        );
      }
      assertCanonicalStudentReadModeActivatable(input.targetMode, input.readiness);

      const maintenance = await readStudentIdentityMaintenanceInTransaction(tx, db);
      if (maintenance.mode !== 'read_only' || maintenance.activeRunId !== input.runId || maintenance.migrationActorId !== input.actorId) {
        throw Object.assign(
          new Error(
            `CANONICAL_READ_REQUIRED_MODE_NEEDS_MAINTENANCE: window holds ${
              maintenance.activeRunId ?? 'no run'
            } in ${maintenance.mode}`
          ),
          { statusCode: 409 }
        );
      }
      
      // `tx.get` is overloaded and picks the query form for an untyped ref,
      // which types `exists`/`data` off a QuerySnapshot. The shape is stated
      // here so the document form is what the rest of this block reads.
      const runSnap = (await tx.get(
        db.doc(`student_profile_merge_runs/${input.runId}`) as never
      )) as unknown as { exists: boolean; data: () => Record<string, unknown> | undefined };
      if (!runSnap.exists) {
        throw Object.assign(new Error(`CANONICAL_READ_RUN_NOT_FOUND: ${input.runId}`), { statusCode: 409 });
      }
      const runData = runSnap.data();
      if (runData?.planDigest !== input.planDigest) {
        throw Object.assign(new Error(`CANONICAL_READ_PLAN_DIGEST_MISMATCH`), { statusCode: 409 });
      }
      if (runData?.approvalDigest !== input.approvalDigest) {
        throw Object.assign(new Error(`CANONICAL_READ_APPROVAL_DIGEST_MISMATCH`), { statusCode: 409 });
      }
    }

    const next: CanonicalStudentReadControlRecord = {
      schemaVersion: 1,
      mode: input.targetMode,
      generation: currentGeneration + 1,
      activatedAt: now.toISOString(),
      activatedBy: input.actorId,
      normalizationRunId: input.runId,
      planDigest: input.planDigest,
      approvalDigest: input.approvalDigest,
    };
    tx.set(db.doc(STUDENT_IDENTITY_READ_MODEL_PATH) as never, next as never);
    return next;
  });
}
