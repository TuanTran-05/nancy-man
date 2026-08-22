import { describe, expect, it } from 'vitest';
import { buildClassStudentCounts } from './classStudentCounts';

describe('buildClassStudentCounts', () => {
  it('counts revoked stale-active records as dropped instead of learning', () => {
    const counts = buildClassStudentCounts([
      { classId: 'class-1', enrollmentStatus: 'active', isRevoked: true },
      { classId: 'class-1', enrollmentStatus: 'active' },
      { classId: 'class-1', enrollmentStatus: 'dropped' },
      { classId: 'class-2', enrollmentStatus: 'active' },
    ]);

    expect(counts['class-1']).toEqual({
      total: 3,
      active: 1,
      trial: 0,
      onLeave: 0,
      dropped: 2,
      promoted: 0,
    });
  });
});
