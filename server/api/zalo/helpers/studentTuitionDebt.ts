import { ledgerRemaining, finiteMoney } from '../../../../shared/money.js';

export type StudentTuitionDebtLedger = {
  id: string;
  classId: string;
  termStart: string;
  termEnd: string;
  amount?: unknown;
  paidTotal?: unknown;
  discountTotal?: unknown;
  status?: unknown;
  tuitionReminderCount?: unknown;
};

export type StudentTuitionDebtSnapshot = {
  debts: Array<{
    ledgerId: string;
    classId: string;
    termStart: string;
    termEnd: string;
    remaining: number;
    reminderCount: number;
  }>;
  ledgerIds: string[];
  grossOutstanding: number;
  walletBalanceApplied: number;
  netOutstanding: number;
  semester: string;
  nextReminderCount: number;
};

const TUITION_REMINDER_SEMESTER_MAX_LENGTH = 100;

/**
 * Error thrown when a ledger is missing valid termStart or termEnd dates.
 */
class StudentTuitionDebtTermDatesError extends Error {
  constructor(
    public readonly statusCode: 400,
    public readonly errorCode: 'TUITION_DEBT_TERM_DATES_MISSING',
    message: string
  ) {
    super(message);
    this.name = 'StudentTuitionDebtTermDatesError';
  }
}

/**
 * Error thrown when a student has no outstanding tuition debt after wallet balance deduction.
 */
class StudentTuitionDebtEmptyError extends Error {
  constructor(
    public readonly statusCode: 400,
    public readonly errorCode: 'TUITION_DEBT_EMPTY',
    message: string
  ) {
    super(message);
    this.name = 'StudentTuitionDebtEmptyError';
  }
}

class StudentTuitionDebtSemesterTooLongError extends Error {
  constructor(
    public readonly statusCode: 400,
    public readonly errorCode: 'TUITION_DEBT_SEMESTER_TOO_LONG',
    message: string
  ) {
    super(message);
    this.name = 'StudentTuitionDebtSemesterTooLongError';
  }
}

/**
 * Format a date string from YYYY-MM-DD to dd/MM format.
 * Takes the first 10 characters of the ISO date string, no timezone conversion.
 */
function formatDayMonth(isoDateString: string): string {
  const dateStr = isoDateString.substring(0, 10); // YYYY-MM-DD
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

/**
 * Validate that a date string matches the ISO format YYYY-MM-DD pattern.
 */
function isValidIsoDate(dateStr: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 100 || month < 1 || month > 12 || day < 1) return false;

  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatSemester(debts: Array<{ termStart: string; termEnd: string }>): string {
  const semester = debts
    .map((debt) => `Khóa ${formatDayMonth(debt.termStart)} - ${formatDayMonth(debt.termEnd)}`)
    .join(', ');
  if (semester.length > TUITION_REMINDER_SEMESTER_MAX_LENGTH) {
    throw new StudentTuitionDebtSemesterTooLongError(
      400,
      'TUITION_DEBT_SEMESTER_TOO_LONG',
      `Tuition debt course list exceeds ${TUITION_REMINDER_SEMESTER_MAX_LENGTH} characters`
    );
  }
  return semester;
}

export function buildStudentTuitionDebtSnapshot(input: {
  ledgers: StudentTuitionDebtLedger[];
  walletBalance: unknown;
}): StudentTuitionDebtSnapshot {
  // Filter to include only debts that need to be included
  const potentialDebts = input.ledgers
    .map((ledger) => ({
      ledger,
      remaining: ledgerRemaining(ledger),
    }))
    .filter(({ ledger, remaining }) => {
      // Filter out paid and waived ledgers
      if (ledger.status === 'paid' || ledger.status === 'waived') {
        return false;
      }
      // Filter out ledgers with zero or negative remaining
      if (remaining <= 0) {
        return false;
      }
      return true;
    });

  // Validate dates for remaining debts
  for (const { ledger } of potentialDebts) {
    if (!isValidIsoDate(ledger.termStart) || !isValidIsoDate(ledger.termEnd)) {
      throw new StudentTuitionDebtTermDatesError(
        400,
        'TUITION_DEBT_TERM_DATES_MISSING',
        `Ledger ${ledger.id} is missing a valid termStart or termEnd`
      );
    }
  }

  // Sort by termStart descending, then by ledgerId
  const sortedDebts = potentialDebts.sort(({ ledger: a }, { ledger: b }) => {
    if (a.termStart !== b.termStart) {
      return b.termStart.localeCompare(a.termStart);
    }
    return a.id.localeCompare(b.id);
  });

  // Build the debt objects with required fields
  const debts = sortedDebts.map(({ ledger, remaining }) => ({
    ledgerId: ledger.id,
    classId: ledger.classId,
    termStart: ledger.termStart,
    termEnd: ledger.termEnd,
    remaining,
    reminderCount: finiteMoney(ledger.tuitionReminderCount),
  }));

  // Calculate outstanding amounts
  const grossOutstanding = debts.reduce((sum, debt) => sum + debt.remaining, 0);
  const walletBalanceApplied = Math.min(
    grossOutstanding,
    Math.max(0, finiteMoney(input.walletBalance))
  );
  const netOutstanding = grossOutstanding - walletBalanceApplied;

  // Check if there's any net debt remaining
  if (netOutstanding <= 0) {
    throw new StudentTuitionDebtEmptyError(
      400,
      'TUITION_DEBT_EMPTY',
      'Student has no outstanding tuition debt'
    );
  }

  // Format semester string
  const semester = formatSemester(debts);

  // Calculate next reminder count
  const nextReminderCount = Math.max(0, ...debts.map((debt) => debt.reminderCount)) + 1;

  return {
    debts,
    ledgerIds: debts.map((debt) => debt.ledgerId),
    grossOutstanding,
    walletBalanceApplied,
    netOutstanding,
    semester,
    nextReminderCount,
  };
}
