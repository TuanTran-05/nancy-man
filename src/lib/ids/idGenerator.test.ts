import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateNextStudentId,
  isValidStudentId,
  isValidTeacherId,
  generateNextClassId,
  generateNextTeacherId,
} from './idGenerator';

describe('isValidStudentId', () => {
  it('should accept valid format HS260001', () => {
    expect(isValidStudentId('HS260001')).toBe(true);
  });

  it('should accept valid format HS000001', () => {
    expect(isValidStudentId('HS000001')).toBe(true);
  });

  it('should reject too short ID', () => {
    expect(isValidStudentId('HS26001')).toBe(false);
  });

  it('should reject wrong prefix', () => {
    expect(isValidStudentId('AB260001')).toBe(false);
  });

  it('should reject letters in number part', () => {
    expect(isValidStudentId('HS26ABCD')).toBe(false);
  });

  it('should reject empty string', () => {
    expect(isValidStudentId('')).toBe(false);
  });
});

describe('isValidTeacherId', () => {
  it('should accept valid format GV0001', () => {
    expect(isValidTeacherId('GV0001')).toBe(true);
  });

  it('should reject wrong prefix', () => {
    expect(isValidTeacherId('TC0001')).toBe(false);
  });

  it('should reject too short', () => {
    expect(isValidTeacherId('GV01')).toBe(false);
  });
});

describe('generateNextStudentId', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should generate first ID when list is empty', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    expect(generateNextStudentId([])).toBe('HS260001');
  });

  it('should generate next sequential ID', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    expect(generateNextStudentId(['HS260001', 'HS260003'])).toBe('HS260004');
  });

  it('should ignore IDs with different prefix', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    expect(generateNextStudentId(['HS259999'])).toBe('HS260001');
  });
});

describe('generateNextTeacherId', () => {
  it('should generate first ID when list is empty', () => {
    expect(generateNextTeacherId([])).toBe('GV0001');
  });

  it('should generate next sequential ID', () => {
    expect(generateNextTeacherId(['GV0001', 'GV0003'])).toBe('GV0004');
  });

  it('should ignore non-matching IDs', () => {
    expect(generateNextTeacherId(['TC0001', 'AB1234'])).toBe('GV0001');
  });
});

describe('generateNextClassId', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should generate first ID for a level', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    expect(generateNextClassId([], 'G8')).toBe('G8-26-01');
  });

  it('should generate next sequential ID', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    expect(generateNextClassId(['G8-26-01', 'G8-26-03'], 'G8')).toBe('G8-26-04');
  });

  it('should strip non-alphanumeric from level name', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    expect(generateNextClassId([], 'IELTS 6.5')).toBe('IELTS65-26-01');
  });

  it('should use CLASS as default when level name is empty', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    expect(generateNextClassId([], '')).toBe('CLASS-26-01');
  });
});
