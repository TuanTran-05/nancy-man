/**
 * Domain module: what a missed session is worth.
 * Pure functions — no DocumentStore, no side-effects.
 *
 * DISPLAY ONLY. Nothing here posts to fee_ledgers or adjusts a balance; the
 * output is a figure for accounting to act on manually.
 *
 * Two distinct buckets (see spec D2):
 *   refundable  — excused absences and on-leave sessions. Already paid for.
 *   notEnrolled — sessions before the student joined. Never paid for, so this
 *                 reconstructs the intake reduction rather than owing money.
 */

export type SessionValueInput = {
  courseFee: number;
  /** Every scheduled session of the course, future ones included. */
  courseTotalSessions: number;
  excusedAbsences: number;
  onLeaveSessions: number;
  notEnrolledSessions: number;
};

export type SessionValueBucket = {
  sessions: number;
  amount: number;
};

export type SessionValueEstimate = {
  /** null when it cannot be computed — render as '—', never as 0. */
  pricePerSession: number | null;
  refundable: SessionValueBucket;
  notEnrolled: SessionValueBucket;
};

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function estimateSessionValue(input: SessionValueInput): SessionValueEstimate {
  const { courseFee, courseTotalSessions } = input;

  const feeUsable = Number.isFinite(courseFee) && courseFee > 0;
  const sessionsUsable = Number.isFinite(courseTotalSessions) && courseTotalSessions > 0;
  const pricePerSession =
    feeUsable && sessionsUsable ? Math.round(courseFee / courseTotalSessions) : null;

  const refundableSessions = safeCount(input.excusedAbsences) + safeCount(input.onLeaveSessions);
  const notEnrolledSessions = safeCount(input.notEnrolledSessions);

  const amountFor = (sessions: number): number =>
    pricePerSession === null ? 0 : pricePerSession * sessions;

  return {
    pricePerSession,
    refundable: { sessions: refundableSessions, amount: amountFor(refundableSessions) },
    notEnrolled: { sessions: notEnrolledSessions, amount: amountFor(notEnrolledSessions) },
  };
}

