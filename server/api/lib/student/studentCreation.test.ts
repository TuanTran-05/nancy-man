import { describe, expect, it } from 'vitest';
import { buildStudentPayload, validateContact } from './studentCreation.js';

describe('validateContact', () => {
  it('accepts email and Zalo-compatible Vietnamese phone formats', () => {
    expect(validateContact('parent@example.com')).toBe(true);
    expect(validateContact('0384072314')).toBe(true);
    expect(validateContact('84384072314')).toBe(true);
    expect(validateContact('+84384072314')).toBe(true);
  });

  it('rejects phone numbers that lost the leading zero in Excel', () => {
    expect(validateContact('384072314')).toBe(false);
  });

  it('stores canonical admission phone fields for future matching', () => {
    const payload = buildStudentPayload(
      {
        name: 'Nguyen Van A',
        dob: '2014-01-01',
        contact: '0384072314',
        classId: 'class-1',
      },
      'HS260001',
      'teacher-1'
    );

    expect(payload.admissionSearchContact).toBe('84384072314');
  });
});
