/**
 * Mirror of `server/api/lib/realtime/events.ts`. Kept as a runtime array rather
 * than a bare type so a parity test can compare the two lists; a client union
 * that quietly falls behind the server produces events nobody listens to.
 *
 * These are event documents under `realtime_events/`. They are a different
 * registry from the read channels under `/api/read/` — `office-academic` is a
 * channel, `office-academic-changed` is an event.
 */
export const REALTIME_EVENT_KEYS = [
  'students',
  'finance-ledger',
  'finance-receipt',
  'finance-expense',
  'parent-tuition',
  'parent-dashboard',
  'admin-summary',
  'admissions',
  'accounting-students',
  'accounting-student-finance',
  'knowledge-bank',
  'assignments',
  'submissions',
  'teacher-attendance',
  'teacher-availability',
  'payroll',
  'course-closing',
  'print-requests',
  'office-schedule-changed',
  'office-academic-changed',
] as const;

export type RealtimeEventKey = (typeof REALTIME_EVENT_KEYS)[number];
