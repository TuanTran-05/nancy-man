import { describe, it, expect } from 'vitest';
import { buildZaloBotDigestPlan } from './digestRules';
import {
  DailyDigestRuleInput,
  ActiveZaloBotRecipient,
  AttendanceDigestSource,
  CourseClosingDigestSource,
  PrintDigestSource,
} from './digestTypes';
import { CourseClosingSnapshot } from '../../../shared/courseClosing';

function createMockInput(): DailyDigestRuleInput {
  return {
    digestDate: '2026-08-15',
    tomorrowDate: '2026-08-16',
    activeRecipients: [
      { staffId: 't1', role: 'teacher', displayName: 'Teacher 1', chatIdHash: 'h1' },
      { staffId: 't2', role: 'teacher', displayName: 'Teacher 2', chatIdHash: 'h2' },
      { staffId: 'o1', role: 'office', displayName: 'Office 1', chatIdHash: 'ho1' },
      { staffId: 'a1', role: 'admin', displayName: 'Admin 1', chatIdHash: 'ha1' },
    ],
    attendance: [],
    courseClosing: [],
    printRequests: [],
    sourceCounts: {
      classes: 10,
      sessions: 20,
      attendanceRows: 100,
      printRequests: 5,
      activeLinks: 4,
      eligibleRecipients: 10,
      outstandingFailedMessages: 0,
      potentialTruncation: [],
    },
  };
}

function createMockSnapshot(status: CourseClosingSnapshot['status']): CourseClosingSnapshot {
  return {
    courseId: 'c1',
    status,
    approvalValid: false,
    requiredStudentCount: 0,
    finalEvaluationCount: 0,
    evaluationSentCount: 0,
    rankRequiredCount: 0,
    rankSentCount: 0,
    tuitionSentCount: 0,
    exemptStudentCount: 0,
    missingEvaluationStudentIds: [],
    pendingEvaluationStudentIds: [],
    pendingRankStudentIds: [],
    pendingTuitionStudentIds: [],
    lockedEvaluationIds: [],
    exemptions: [],
  };
}

describe('ZaloBot Digest Rules', () => {
  it('1. Attendance included for scheduled=true session', () => {
    const input = createMockInput();
    input.attendance.push({
      classId: 'c1',
      className: 'Class 1',
      date: '2026-08-10',
      scheduled: true,
      sessionStatus: 'unconfirmed',
      primaryTeacherId: 't1',
      effectiveTeacherId: 't1',
      eligibleStudentIds: ['s1', 's2'],
      markedStudentIds: ['s1'],
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('t1')?.attendance).toHaveLength(1);
    expect(plan.get('t1')?.attendance[0].missingStudentCount).toBe(1);
  });

  it('2. Attendance included for explicit taught session (even non-regular day)', () => {
    const input = createMockInput();
    input.attendance.push({
      classId: 'c1',
      className: 'Class 1',
      date: '2026-08-10',
      scheduled: false,
      sessionStatus: 'taught',
      primaryTeacherId: 't1',
      effectiveTeacherId: 't1',
      eligibleStudentIds: ['s1'],
      markedStudentIds: [],
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('t1')?.attendance).toHaveLength(1);
  });

  it('3. Attendance included for makeup session', () => {
    const input = createMockInput();
    input.attendance.push({
      classId: 'c1',
      className: 'Class 1',
      date: '2026-08-10',
      scheduled: false,
      sessionStatus: 'makeup',
      primaryTeacherId: 't1',
      effectiveTeacherId: 't1',
      eligibleStudentIds: ['s1'],
      markedStudentIds: [],
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('t1')?.attendance).toHaveLength(1);
  });

  it('4. cancelled session excluded', () => {
    const input = createMockInput();
    input.attendance.push({
      classId: 'c1',
      className: 'Class 1',
      date: '2026-08-10',
      scheduled: true,
      sessionStatus: 'cancelled',
      primaryTeacherId: 't1',
      effectiveTeacherId: 't1',
      eligibleStudentIds: ['s1'],
      markedStudentIds: [],
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.has('t1')).toBe(false); // No items, omitted
  });

  it('5. Attendance item goes to effectiveTeacherId (not primary)', () => {
    const input = createMockInput();
    input.attendance.push({
      classId: 'c1',
      className: 'Class 1',
      date: '2026-08-10',
      scheduled: true,
      sessionStatus: 'unconfirmed',
      primaryTeacherId: 't1',
      effectiveTeacherId: 't2',
      eligibleStudentIds: ['s1'],
      markedStudentIds: [],
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.has('t1')).toBe(false);
    expect(plan.get('t2')?.attendance).toHaveLength(1);
  });

  it('6. Extra rows for ineligible students do not count as marked', () => {
    const input = createMockInput();
    input.attendance.push({
      classId: 'c1',
      className: 'Class 1',
      date: '2026-08-10',
      scheduled: true,
      sessionStatus: 'unconfirmed',
      primaryTeacherId: 't1',
      effectiveTeacherId: 't1',
      eligibleStudentIds: ['s1', 's2'],
      markedStudentIds: ['s1', 's3'], // s3 is extra, s2 missing
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('t1')?.attendance[0].missingStudentCount).toBe(1);
  });

  it('7. Course closing included at D-7, D-3, D-1 when not completed', () => {
    const input = createMockInput();
    // digest is 08-15. D-7 => endDate 08-22
    // D-3 => endDate 08-18
    // D-1 => endDate 08-16
    input.courseClosing.push({
      classId: 'c1',
      className: 'C1',
      primaryTeacherId: 't1',
      endDate: '2026-08-22',
      snapshot: createMockSnapshot('missing_evaluations'),
    });
    input.courseClosing.push({
      classId: 'c2',
      className: 'C2',
      primaryTeacherId: 't1',
      endDate: '2026-08-18',
      snapshot: createMockSnapshot('ready_for_approval'),
    });
    input.courseClosing.push({
      classId: 'c3',
      className: 'C3',
      primaryTeacherId: 't1',
      endDate: '2026-08-16',
      snapshot: createMockSnapshot('stale'),
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('t1')?.courseClosing).toHaveLength(3);
  });

  it('8. Course closing excluded at D-2 (not a reminder day)', () => {
    const input = createMockInput();
    input.courseClosing.push({
      classId: 'c1',
      className: 'C1',
      primaryTeacherId: 't1',
      endDate: '2026-08-17', // diff = 2
      snapshot: createMockSnapshot('missing_evaluations'),
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.has('t1')).toBe(false);
  });

  it('9. Course closing excluded when status=completed', () => {
    const input = createMockInput();
    input.courseClosing.push({
      classId: 'c1',
      className: 'C1',
      primaryTeacherId: 't1',
      endDate: '2026-08-22',
      snapshot: createMockSnapshot('completed'),
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.has('t1')).toBe(false);
  });

  it('10. Course closing goes to primaryTeacherId', () => {
    const input = createMockInput();
    input.courseClosing.push({
      classId: 'c1',
      className: 'C1',
      primaryTeacherId: 't2',
      endDate: '2026-08-22',
      snapshot: createMockSnapshot('missing_evaluations'),
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('t2')?.courseClosing).toHaveLength(1);
    expect(plan.has('t1')).toBe(false);
  });

  it('11. Print included when status=pending and neededDate <= tomorrow', () => {
    const input = createMockInput(); // tomorrow = 2026-08-16
    input.printRequests.push({
      requestId: 'p1',
      className: 'C1',
      teacherName: 'T1',
      neededDate: '2026-08-16',
      status: 'pending',
      fileCount: 1,
      totalCopies: 10,
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('o1')?.printRequests).toHaveLength(1);
  });

  it('12. Print excluded when status!=pending', () => {
    const input = createMockInput();
    input.printRequests.push({
      requestId: 'p1',
      className: 'C1',
      teacherName: 'T1',
      neededDate: '2026-08-16',
      status: 'printed',
      fileCount: 1,
      totalCopies: 10,
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.has('o1')).toBe(false);
  });

  it('13. Print (overdue, neededDate < today) still included', () => {
    const input = createMockInput();
    input.printRequests.push({
      requestId: 'p1',
      className: 'C1',
      teacherName: 'T1',
      neededDate: '2026-08-10', // < today
      status: 'pending',
      fileCount: 1,
      totalCopies: 10,
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('o1')?.printRequests).toHaveLength(1);
  });

  it('14. Office recipients get the print queue', () => {
    const input = createMockInput();
    input.activeRecipients.push({
      staffId: 'o2',
      role: 'office',
      displayName: 'Office 2',
      chatIdHash: 'ho2',
    });
    input.printRequests.push({
      requestId: 'p1',
      className: 'C1',
      teacherName: 'T1',
      neededDate: '2026-08-16',
      status: 'pending',
      fileCount: 1,
      totalCopies: 10,
    });
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.get('o1')?.printRequests).toHaveLength(1);
    expect(plan.get('o2')?.printRequests).toHaveLength(1);
  });

  it('15. Admin recipients get counts even with zeros', () => {
    const input = createMockInput();
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.has('a1')).toBe(true);
    expect(plan.get('a1')?.adminSummary).toBeDefined();
    expect(plan.get('a1')?.adminSummary?.pendingPrintRequests).toBe(0);
  });

  it('16. Teacher with no items omitted from plan', () => {
    const input = createMockInput();
    const plan = buildZaloBotDigestPlan(input);
    expect(plan.has('t1')).toBe(false);
    expect(plan.has('t2')).toBe(false);
    expect(plan.has('o1')).toBe(false);
  });
});
