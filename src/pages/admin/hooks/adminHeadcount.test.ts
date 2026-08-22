import { describe, expect, it } from 'vitest';
import { selectAdminHeadcount } from './adminHeadcount';

/**
 * The headline number on the admin dashboard, and the two ways it can lie:
 * a client-side collapse that cannot see duplicated profiles, and a stored
 * aggregate that can simply be old.
 */
const NOW = new Date('2026-08-09T10:00:00.000Z');

const summary = { totalStudents: 60, activeStudents: 42 };

function canonicalHeadcount(overrides: Record<string, unknown> = {}) {
  return {
    openEnrollmentCount: 59,
    studyingCanonicalCount: 41,
    generatedAt: '2026-08-09T09:58:00.000Z',
    sourceUpdatedAt: '2026-08-09T09:58:00.000Z',
    ...overrides,
  };
}

describe('selectAdminHeadcount', () => {
  it('reports the canonical count rather than recollapsing the index', () => {
    // The client collapse keys rows on name, date of birth, and contact. The
    // two documents of a duplicated pair agree on all three, so both survive
    // and one child is counted twice.
    expect(
      selectAdminHeadcount({ canonicalHeadcount: canonicalHeadcount(), summary }, NOW)
    ).toEqual({ total: 59, active: 41, canonical: true });
  });

  it('does not treat zero enrolled students as a missing answer', () => {
    // A center between terms is a real state, and falling back there would
    // report students nobody is teaching.
    expect(
      selectAdminHeadcount(
        {
          canonicalHeadcount: canonicalHeadcount({
            openEnrollmentCount: 0,
            studyingCanonicalCount: 0,
          }),
          summary,
        },
        NOW
      )
    ).toEqual({ total: 0, active: 0, canonical: true });
  });

  it('falls back to the server summary when the aggregate has gone stale', () => {
    // Never to a client-side collapse: that keys on name, date of birth, and
    // contact, which is exactly what a duplicated pair shares. A stale number
    // is a smaller lie than a confident wrong one, and it says which it is.
    const counts = selectAdminHeadcount(
      {
        canonicalHeadcount: canonicalHeadcount({ generatedAt: '2026-08-09T08:00:00.000Z' }),
        summary,
      },
      NOW
    );

    expect(counts).toEqual({ total: 60, active: 42, canonical: false });
  });

  it('falls back when the server sent no canonical count at all', () => {
    expect(selectAdminHeadcount({ summary }, NOW)).toEqual({
      total: 60,
      active: 42,
      canonical: false,
    });
  });

  it('reports zero rather than guessing when the server sent nothing', () => {
    expect(selectAdminHeadcount({}, NOW)).toEqual({ total: 0, active: 0, canonical: false });
  });
});
