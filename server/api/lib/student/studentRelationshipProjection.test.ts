import { describe, expect, it, vi } from 'vitest';

const { deleteSentinel } = vi.hoisted(() => ({ deleteSentinel: Symbol('delete') }));

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    delete: vi.fn(() => deleteSentinel),
  },
}));

import {
  buildStudentRelationshipCreateFields,
  buildStudentRelationshipUpdateFields,
} from './studentRelationshipProjection.js';

describe('student relationship projections', () => {
  const input = {
    classId: 'class-1',
    teacherId: 'teacher-1',
    enrollmentStatus: 'active',
  };

  it('omits every legacy relationship projection during canonical-required creation', () => {
    expect(buildStudentRelationshipCreateFields('canonical_required', input)).toEqual({});
  });

  it('deletes every legacy relationship projection during canonical-required updates', () => {
    expect(buildStudentRelationshipUpdateFields('canonical_required', input)).toEqual({
      classId: deleteSentinel,
      teacherId: deleteSentinel,
      enrollmentStatus: deleteSentinel,
    });
  });

  it.each(['legacy_compare', 'canonical_preferred'] as const)(
    'keeps supplied legacy relationship projections during %s creation',
    (mode) => {
      expect(buildStudentRelationshipCreateFields(mode, input)).toEqual(input);
    }
  );

  it('does not add relationship fields that were not supplied', () => {
    expect(buildStudentRelationshipCreateFields('legacy_compare', { classId: 'class-1' })).toEqual({
      classId: 'class-1',
    });
  });
});
