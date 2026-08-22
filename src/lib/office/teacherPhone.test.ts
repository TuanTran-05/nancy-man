import { describe, expect, it } from 'vitest';
import { formatTeacherPhone, teacherPhoneSearchText } from './teacherPhone';

describe('teacher phone formatting', () => {
  it.each([
    ['84384072314', '0384072314'],
    ['+84384072314', '0384072314'],
    ['  +84384072314  ', '0384072314'],
    ['0384072314', '0384072314'],
    ['', ''],
  ])('formats %s as %s', (input, expected) => {
    expect(formatTeacherPhone(input)).toBe(expected);
  });

  it('includes both raw and local phone forms for +84-prefixed search text', () => {
    expect(teacherPhoneSearchText('+84384072314')).toBe('+84384072314 0384072314');
  });

  it('does not duplicate the search text when the display phone is unchanged', () => {
    expect(teacherPhoneSearchText('0384072314')).toBe('0384072314');
  });
});
