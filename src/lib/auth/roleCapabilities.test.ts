import { describe, expect, it } from 'vitest';
import { canUseAcademicRecords, canUseOfficeAdmissions, isOfficeRole } from './roleCapabilities';

describe('frontend role capabilities', () => {
  it('lets office use admissions and academic records without treating teachers as admissions users', () => {
    expect(canUseOfficeAdmissions('office')).toBe(true);
    expect(canUseOfficeAdmissions('teacher')).toBe(false);
    expect(canUseAcademicRecords('office')).toBe(true);
    expect(canUseAcademicRecords('teacher')).toBe(true);
    expect(isOfficeRole('office')).toBe(true);
  });
});
