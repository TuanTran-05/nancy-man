import { describe, expect, it } from 'vitest';
import { sanitizeAdminQuestion } from './adminQuestionSanitizer.js';

describe('adminQuestionSanitizer', () => {
  it('redacts phone numbers while preserving sentence structure and names', () => {
    const raw = 'Tìm thông tin học sinh có sđt 0912345678 lớp cô Lan';
    const result = sanitizeAdminQuestion(raw);

    expect(result.sanitizedText).toBe('Tìm thông tin học sinh có sđt [PHONE] lớp cô Lan');
    expect(result.extractedPhones).toEqual(['0912345678']);
  });

  it('redacts email addresses and student codes', () => {
    const raw = 'Học viên HV-1002 email minh@example.com đã đóng tiền chưa?';
    const result = sanitizeAdminQuestion(raw);

    expect(result.sanitizedText).toBe('Học viên [STUDENT_CODE] email [EMAIL] đã đóng tiền chưa?');
    expect(result.extractedStudentCodes).toEqual(['HV-1002']);
    expect(result.extractedEmails).toEqual(['minh@example.com']);
  });

  it('strips non-printable control characters and normalizes whitespace', () => {
    const raw = '  Doanh\u0000 thu   tháng\t này\n   ';
    const result = sanitizeAdminQuestion(raw);

    expect(result.sanitizedText).toBe('Doanh thu tháng này');
  });

  it('redacts money literals before classification', () => {
    const result = sanitizeAdminQuestion('Học phí 2.500.000 VND và lương 500k');
    expect(result.sanitizedText).toBe('Học phí [MONEY] và lương [MONEY]');
    expect(result.extractedMoneyLiterals).toEqual(['2.500.000 VND', '500k']);
  });

  it('returns empty results on empty or invalid input', () => {
    expect(sanitizeAdminQuestion('')).toEqual({
      sanitizedText: '',
      extractedPhones: [],
      extractedEmails: [],
      extractedStudentCodes: [],
      extractedMoneyLiterals: [],
    });
    expect(sanitizeAdminQuestion(null as any)).toEqual({
      sanitizedText: '',
      extractedPhones: [],
      extractedEmails: [],
      extractedStudentCodes: [],
      extractedMoneyLiterals: [],
    });
  });
});
