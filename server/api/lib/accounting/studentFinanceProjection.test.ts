import { describe, expect, it } from 'vitest';
import { makeStudentCourseEnrollmentId, type StudentCourseEnrollment } from '../../../../shared/studentCourseEnrollment.js';
import { buildAccountingStudentSummary } from './studentFinanceProjection.js';

const enrollment = (status: StudentCourseEnrollment['status'], classId = 'class-1'): StudentCourseEnrollment => ({
  id: makeStudentCourseEnrollmentId('student-1', classId, '2026-06-01'), studentId: 'student-1', classId, termStart: '2026-06-01', termEnd: '2026-06-30', status,
  joinedAt: '2026-06-01', endedAt: status === 'active' ? null : '2026-06-30', statusReason: null, source: 'system', confidence: 'confirmed',
  statusChangedAt: '2026-06-01T00:00:00.000Z', statusChangedBy: 'system', confirmedAt: null, confirmedBy: null, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
});

describe('student finance summary projection', () => {
  it('derives outstanding and overdue priority from the ledger', () => {
    const summary = buildAccountingStudentSummary({
      student: { id: 'student-1', name: 'Nguyễn An', studentId: 'ST-1', classId: 'class-1', studentLifecycle: 'enrolled' },
      enrollments: [enrollment('active')],
      ledgers: [{ id: 'ledger-1', classId: 'class-1', amount: 1000, discountTotal: 100, paidTotal: 400, dueDate: '2026-06-10' }],
      today: '2026-06-15',
    });
    expect(summary).toMatchObject({ currentCoursePaymentStatus: 'overdue', totalPaid: 400, totalOutstanding: 500, priorityRank: 0, classCount: 1, courseCount: 1 });
    expect(summary.studentNameNormalized).toBe('nguyen an');
  });

  /**
   * A student whose courses have all ended has no "current" course, but the badge
   * still has to tell the truth about money: "Đã đóng" next to a non-zero balance
   * is what sent accounting to the receipt dialog to find debt it could not see.
   */
  it('reports the outstanding balance when no enrollment is open', () => {
    const summary = buildAccountingStudentSummary({
      student: { id: 'student-1', name: 'Nguyễn An', studentId: 'ST-1', studentLifecycle: 'enrolled' },
      enrollments: [enrollment('completed')],
      ledgers: [{ id: 'ledger-1', classId: 'class-1', amount: 1400000, paidTotal: 0, dueDate: '2026-06-10' }],
      today: '2026-08-05',
    });
    expect(summary.currentCoursePaymentStatus).toBe('overdue');
    expect(summary.totalOutstanding).toBe(1400000);
    expect(summary.priorityRank).toBe(0);
  });

  it('keeps a settled student with no open enrollment on the paid badge', () => {
    const summary = buildAccountingStudentSummary({
      student: { id: 'student-1', name: 'Nguyễn An', studentId: 'ST-1', studentLifecycle: 'graduated' },
      enrollments: [enrollment('completed')],
      ledgers: [{ id: 'ledger-1', classId: 'class-1', amount: 1400000, paidTotal: 1400000, dueDate: '2026-06-10' }],
      today: '2026-08-05',
    });
    expect(summary.currentCoursePaymentStatus).toBe('paid');
    expect(summary.totalOutstanding).toBe(0);
  });

  /**
   * The badge and the outstanding column sit side by side in the workspace, so
   * "Đã đóng" next to a non-zero balance reads as a contradiction no matter which
   * course the debt belongs to. A settled badge has to mean the student owes
   * nothing anywhere.
   */
  it('refuses a settled badge while an older course is still owed', () => {
    const summary = buildAccountingStudentSummary({
      student: { id: 'student-1', name: 'Nguyễn An', studentId: 'ST-1', studentLifecycle: 'enrolled' },
      enrollments: [enrollment('active', 'class-now')],
      ledgers: [
        { id: 'ledger-now', classId: 'class-now', amount: 1200000, paidTotal: 1200000, dueDate: '2026-07-10' },
        { id: 'ledger-old', classId: 'class-old', amount: 1200000, paidTotal: 0, dueDate: '2026-06-10' },
      ],
      today: '2026-08-05',
    });
    expect(summary.currentCoursePaymentStatus).toBe('overdue');
    expect(summary.totalOutstanding).toBe(1200000);
  });

  it('keeps the paid badge once nothing is outstanding anywhere', () => {
    const summary = buildAccountingStudentSummary({
      student: { id: 'student-1', name: 'Nguyễn An', studentId: 'ST-1', studentLifecycle: 'enrolled' },
      enrollments: [enrollment('active', 'class-now')],
      ledgers: [
        { id: 'ledger-now', classId: 'class-now', amount: 1200000, paidTotal: 1200000, dueDate: '2026-07-10' },
        { id: 'ledger-old', classId: 'class-old', amount: 1200000, paidTotal: 1200000, dueDate: '2026-06-10' },
      ],
      today: '2026-08-05',
    });
    expect(summary.currentCoursePaymentStatus).toBe('paid');
    expect(summary.totalOutstanding).toBe(0);
  });

  it('reports debt carried by a ledger whose enrollment row is missing', () => {
    const summary = buildAccountingStudentSummary({
      student: { id: 'student-1', name: 'Nguyễn An', studentId: 'ST-1', studentLifecycle: 'enrolled' },
      enrollments: [],
      ledgers: [{ id: 'ledger-1', classId: 'class-9', amount: 1300000, paidTotal: 0, dueDate: '2027-01-10' }],
      today: '2026-08-05',
    });
    expect(summary.currentCoursePaymentStatus).toBe('unpaid');
    expect(summary.totalOutstanding).toBe(1300000);
  });
});
