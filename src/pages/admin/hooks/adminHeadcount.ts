import {
  isDashboardReadModelStale,
  type DashboardReadModelV3,
} from '../../../../shared/dashboardReadModel';

type HeadcountProjection = {
  canonicalHeadcount?: Pick<
    DashboardReadModelV3,
    'openEnrollmentCount' | 'studyingCanonicalCount' | 'generatedAt' | 'sourceUpdatedAt'
  >;
  summary?: { totalStudents?: number; activeStudents?: number };
};

export type SelectedAdminHeadcount = {
  total: number;
  active: number;
  /** Whether the number came from enrollments or from the legacy summary. */
  canonical: boolean;
};

/**
 * The headline number on the admin dashboard.
 *
 * Three answers were available and two of them are wrong.
 *
 * Collapsing the student index on the client keys rows on name, date of birth,
 * and contact — a guess that is blind to every one of the fifty-nine
 * doubly-owned codes in production, because the two documents of a duplicated
 * pair agree on all three. One child is counted twice on the headline number,
 * and no amount of care in the caller fixes that.
 *
 * The stored canonical model can simply be old: it is served as-is, so
 * preferring it unconditionally means showing a number from whenever the
 * aggregate last ran.
 *
 * So the canonical count wins while it is fresh — it is the one number derived
 * from enrollments — and otherwise the server's own summary is reported, with
 * `canonical: false` so the surface can say which it is. What is never done is
 * re-deciding identity here; a stale number is a smaller lie than a confident
 * wrong one.
 */
export function selectAdminHeadcount(
  projection: HeadcountProjection,
  now = new Date()
): SelectedAdminHeadcount {
  const canonical = projection.canonicalHeadcount;
  if (canonical && !isDashboardReadModelStale(canonical, now)) {
    return {
      total: canonical.openEnrollmentCount,
      active: canonical.studyingCanonicalCount,
      canonical: true,
    };
  }
  return {
    total: Number(projection.summary?.totalStudents ?? 0),
    active: Number(projection.summary?.activeStudents ?? 0),
    canonical: false,
  };
}
