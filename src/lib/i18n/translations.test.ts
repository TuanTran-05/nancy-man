import { describe, expect, it } from 'vitest';
import { translations } from './translations';

const MALFORMED_UNICODE =
  /\uFFFD|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|á[º»]|Ä[\u0080-\u00BF]|Æ[\u0080-\u00BF]/u;

function collectMalformedStrings(value: unknown, path = 'vi', malformed: string[] = []): string[] {
  if (typeof value === 'string') {
    if (MALFORMED_UNICODE.test(value)) {
      malformed.push(`${path}: ${value}`);
    }
    return malformed;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectMalformedStrings(child, `${path}.${key}`, malformed);
    }
  }

  return malformed;
}

describe('Vietnamese translations', () => {
  it('contains no replacement characters or mojibake', () => {
    expect(collectMalformedStrings(translations.vi)).toEqual([]);
  });
});

describe('finance detail translations', () => {
  it.each([
    ['en', 'No income transactions in this period.', 'No expense transactions in this period.'],
    ['vi', 'Không có khoản thu trong kỳ này.', 'Không có khoản chi trong kỳ này.'],
  ] as const)('uses period-neutral empty states for %s', (language, income, expense) => {
    const details = translations[language].adminFinanceReport.details;

    expect(details.emptyIncome).toBe(income);
    expect(details.emptyExpense).toBe(expense);
  });
});
