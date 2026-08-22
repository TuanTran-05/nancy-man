import type { CanonicalStudentPlacementStatus } from './canonicalStudentReadModel.js';

/**
 * What the dashboard counts, and why the version number is part of it.
 *
 * Version 2 counted `students` documents. That number was the headline figure
 * on the admin dashboard, and it was wrong by exactly the number of duplicate
 * profiles in production — fifty-nine children counted twice. The user-visible
 * total is `canonicalProfileCount`; `physicalStudentDocumentCount` is kept
 * beside it as observability, because during and after normalization the two
 * legitimately differ and an operator needs to see the gap rather than guess
 * at it.
 */
export type DashboardReadModelV3 = {
  schemaVersion: 3;
  physicalStudentDocumentCount: number;
  canonicalProfileCount: number;
  aliasCount: number;
  tombstoneCount: number;
  openEnrollmentCount: number;
  trialCanonicalCount: number;
  studyingCanonicalCount: number;
  onLeaveCanonicalCount: number;
  waitingForPlacementCanonicalCount: number;
  inactiveCanonicalCount: number;
  requiredModeBlockerCount: number;
  complete: boolean;
  generatedAt: string;
  sourceUpdatedAt: string;
};

export const DASHBOARD_MODEL_MAX_AGE_MS = 15 * 60 * 1000;

export type DashboardHeadcountInput = {
  physicalStudentDocumentCount: number;
  aliasCount: number;
  tombstoneCount: number;
  openEnrollmentCount: number;
  requiredModeBlockerCount: number;
  placementStatuses: readonly CanonicalStudentPlacementStatus[];
  generatedAt: string;
  sourceUpdatedAt: string;
};

/**
 * Builds the model from one placement status per canonical profile.
 *
 * The caller passes one entry per *profile*, never one per enrollment: a
 * student with two open enrollments is a data fault, and counting them twice
 * is how a broken record inflates the headline number instead of being noticed.
 */
export function buildDashboardReadModel(input: DashboardHeadcountInput): DashboardReadModelV3 {
  const count = (status: CanonicalStudentPlacementStatus) =>
    input.placementStatuses.filter((value) => value === status).length;

  const canonicalProfileCount = input.placementStatuses.length;
  return {
    schemaVersion: 3,
    physicalStudentDocumentCount: input.physicalStudentDocumentCount,
    canonicalProfileCount,
    aliasCount: input.aliasCount,
    tombstoneCount: input.tombstoneCount,
    openEnrollmentCount: input.openEnrollmentCount,
    trialCanonicalCount: count('trial'),
    studyingCanonicalCount: count('studying'),
    onLeaveCanonicalCount: count('on_leave'),
    waitingForPlacementCanonicalCount: count('waiting_for_placement'),
    inactiveCanonicalCount: count('inactive'),
    requiredModeBlockerCount: input.requiredModeBlockerCount,
    // An open enrollment that belongs to no counted profile means a student is
    // in a class the headcount does not know about.
    complete:
      input.requiredModeBlockerCount === 0 &&
      input.openEnrollmentCount ===
        count('trial') + count('studying') + count('on_leave'),
    generatedAt: input.generatedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
  };
}

/**
 * Stale means the number on screen may already be wrong.
 *
 * Either the model is older than the refresh window, or a source has been
 * written since it was generated. The second case is the one that matters
 * during a school day: a model generated a minute ago is still stale if a
 * student enrolled thirty seconds later.
 */
export function isDashboardReadModelStale(
  model: Pick<DashboardReadModelV3, 'generatedAt' | 'sourceUpdatedAt'>,
  now: Date,
  latestSourceWatermark?: string
): boolean {
  const generatedAt = Date.parse(model.generatedAt);
  if (!Number.isFinite(generatedAt)) return true;
  if (now.getTime() - generatedAt > DASHBOARD_MODEL_MAX_AGE_MS) return true;
  if (!latestSourceWatermark) return false;
  return String(model.sourceUpdatedAt || '') < latestSourceWatermark;
}
