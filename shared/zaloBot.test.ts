import { describe, expect, it } from 'vitest';
import { makeZaloBotDailyMessageId, parseZaloBotLinkCommand, isZaloBotStaffRole } from './zaloBot';

describe('zalo bot contracts', () => {
  it('accepts only notification recipients', () => {
    expect(['teacher', 'office', 'admin'].filter(isZaloBotStaffRole)).toEqual([
      'teacher',
      'office',
      'admin',
    ]);
    expect(isZaloBotStaffRole('accounting')).toBe(false);
  });

  it('parses a case-insensitive one-time link command', () => {
    expect(parseZaloBotLinkCommand('  /LiNk a7k9-q2  ')).toBe('A7K9Q2');
    expect(parseZaloBotLinkCommand('xin chào')).toBeNull();
    expect(parseZaloBotLinkCommand('/link abc')).toBeNull();
    expect(parseZaloBotLinkCommand('/link ABCD EFGH')).toBeNull();
    expect(parseZaloBotLinkCommand('/link ABCD!EFG')).toBeNull();
  });

  it('builds one stable digest id per staff and date', () => {
    expect(makeZaloBotDailyMessageId('2026-08-15', 'teacher/01')).toBe(
      'daily_digest_2026-08-15_teacher_01'
    );
    expect(makeZaloBotDailyMessageId('2026-08-15', 'teacher-01')).toBe(
      'daily_digest_2026-08-15_teacher-01'
    );
    expect(makeZaloBotDailyMessageId('2026-08-15', 'teacher_01')).toBe(
      'daily_digest_2026-08-15_teacher_01'
    );
  });
});
