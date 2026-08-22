import { describe, expect, it } from 'vitest';
import {
  buildDashboardReadModel,
  isDashboardReadModelStale,
  DASHBOARD_MODEL_MAX_AGE_MS,
} from './dashboardReadModel.js';
import type { CanonicalStudentPlacementStatus } from './canonicalStudentReadModel.js';

const GENERATED_AT = '2026-08-08T10:00:00.000Z';

function model(
  placementStatuses: CanonicalStudentPlacementStatus[],
  overrides: Partial<Parameters<typeof buildDashboardReadModel>[0]> = {}
) {
  return buildDashboardReadModel({
    physicalStudentDocumentCount: placementStatuses.length,
    aliasCount: 0,
    tombstoneCount: 0,
    openEnrollmentCount: placementStatuses.filter((status) =>
      ['trial', 'studying', 'on_leave'].includes(status)
    ).length,
    requiredModeBlockerCount: 0,
    placementStatuses,
    generatedAt: GENERATED_AT,
    sourceUpdatedAt: GENERATED_AT,
    ...overrides,
  });
}

describe('dashboard headcount', () => {
  it('makes the canonical profile count the user-visible total', () => {
    // The headline figure used to be the physical document count, which was
    // wrong by exactly the number of duplicate profiles: fifty-nine children
    // counted twice.
    const built = model(['studying', 'studying', 'waiting_for_placement'], {
      physicalStudentDocumentCount: 7,
      aliasCount: 4,
      tombstoneCount: 4,
    });

    expect(built).toMatchObject({
      schemaVersion: 3,
      canonicalProfileCount: 3,
      physicalStudentDocumentCount: 7,
      aliasCount: 4,
      tombstoneCount: 4,
    });
  });

  it('buckets every placement status separately', () => {
    expect(
      model(['trial', 'studying', 'studying', 'on_leave', 'waiting_for_placement', 'inactive'])
    ).toMatchObject({
      trialCanonicalCount: 1,
      studyingCanonicalCount: 2,
      onLeaveCanonicalCount: 1,
      waitingForPlacementCanonicalCount: 1,
      inactiveCanonicalCount: 1,
    });
  });

  it('adds nothing for a physical duplicate with no open enrollment', () => {
    // The duplicate is not in the placement list at all: it resolved to the
    // profile already counted. Its document still shows in the physical count.
    const built = model(['studying'], { physicalStudentDocumentCount: 2, aliasCount: 1 });

    expect(built.canonicalProfileCount).toBe(1);
    expect(built.studyingCanonicalCount).toBe(1);
  });

  it('is incomplete when an open enrollment belongs to nobody counted', () => {
    // A student is in a class the headcount does not know about, which is
    // worse than a wrong total because nothing on screen looks unusual.
    expect(model(['studying'], { openEnrollmentCount: 2 }).complete).toBe(false);
  });

  it('is incomplete while a required-mode blocker remains', () => {
    expect(model(['studying'], { requiredModeBlockerCount: 1 }).complete).toBe(false);
  });

  it('counts a waiting student in the total without counting an enrollment', () => {
    const built = model(['studying', 'waiting_for_placement']);
    expect(built).toMatchObject({ canonicalProfileCount: 2, openEnrollmentCount: 1, complete: true });
  });
});

describe('dashboard staleness', () => {
  const now = new Date('2026-08-08T10:05:00.000Z');

  it('is fresh inside the refresh window with no newer source', () => {
    expect(
      isDashboardReadModelStale({ generatedAt: GENERATED_AT, sourceUpdatedAt: GENERATED_AT }, now)
    ).toBe(false);
  });

  it('is stale once older than the refresh window', () => {
    const later = new Date(Date.parse(GENERATED_AT) + DASHBOARD_MODEL_MAX_AGE_MS + 1);
    expect(
      isDashboardReadModelStale({ generatedAt: GENERATED_AT, sourceUpdatedAt: GENERATED_AT }, later)
    ).toBe(true);
  });

  it('is stale when a source was written after it was generated', () => {
    // The case that matters during a school day: a model built a minute ago is
    // still stale if a student enrolled thirty seconds later.
    expect(
      isDashboardReadModelStale(
        { generatedAt: GENERATED_AT, sourceUpdatedAt: GENERATED_AT },
        now,
        '2026-08-08T10:01:00.000Z'
      )
    ).toBe(true);
  });

  it('treats an unparseable timestamp as stale rather than fresh', () => {
    expect(isDashboardReadModelStale({ generatedAt: '', sourceUpdatedAt: '' }, now)).toBe(true);
  });
});
