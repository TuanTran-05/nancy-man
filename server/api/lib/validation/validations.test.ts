import { describe, expect, it } from 'vitest';
import {
  createAssignmentSchema,
  createClassSchema,
  createEvaluationSchema,
  createExpenseSchema,
  createReceiptSchema,
  createStudentWalletRefundSchema,
  createWalletAllocationSchema,
  createWalletManualReceiptSchema,
  apiDateOnlySchema,
  apiDateTimeSchema,
  apiTimeOnlySchema,
  attendanceToggleSchema,
  createStudentSchema,
  voidFinanceMutationSchema,
} from './validations';

describe('API canonical date time schemas', () => {
  it('accepts canonical date-only values and rejects display dates', () => {
    expect(apiDateOnlySchema.safeParse('2026-06-05').success).toBe(true);
    expect(apiDateOnlySchema.safeParse('05/06/2026').success).toBe(false);
    expect(apiDateOnlySchema.safeParse('2026-02-29').success).toBe(false);
  });

  it('accepts canonical time-only values', () => {
    expect(apiTimeOnlySchema.safeParse('05:09:00').success).toBe(true);
    expect(apiTimeOnlySchema.safeParse('05:09').success).toBe(false);
    expect(apiTimeOnlySchema.safeParse('24:00:00').success).toBe(false);
  });

  it('accepts ISO 8601 datetimes only for datetime fields', () => {
    expect(apiDateTimeSchema.safeParse('2026-06-05T10:30:00.000Z').success).toBe(true);
    expect(apiDateTimeSchema.safeParse('05:09:00 05/06/2026').success).toBe(false);
  });

  it('keeps existing student and attendance API date fields canonical', () => {
    expect(
      createStudentSchema.safeParse({
        name: 'An',
        dob: '2026-06-05',
        contact: 'parent@example.com',
        classId: 'class-1',
      }).success
    ).toBe(true);
    expect(
      createStudentSchema.safeParse({
        name: 'An',
        dob: '05/06/2026',
        contact: 'parent@example.com',
        classId: 'class-1',
      }).success
    ).toBe(false);
    expect(
      attendanceToggleSchema.safeParse({
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-06-05',
        status: 'present',
      }).success
    ).toBe(true);
    expect(
      attendanceToggleSchema.safeParse({
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-06-05',
        status: 'present',
        eligibilityOverride: true,
        overrideReason: 'Attended during leave',
      }).success
    ).toBe(true);
    expect(
      attendanceToggleSchema.safeParse({
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-06-05',
        status: 'present',
        eligibilityOverride: true,
      }).success
    ).toBe(false);
    expect(
      attendanceToggleSchema.safeParse({
        classId: 'class-1',
        studentId: 'student-1',
        date: '2026-06-05',
        status: 'present',
        overrideReason: 'Attended during leave',
      }).success
    ).toBe(false);
  });

  it('requires ISO datetimes for assignment due dates', () => {
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
      }).success
    ).toBe(true);
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
        proctoringMode: 'strict',
      }).success
    ).toBe(true);
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
        proctoringMode: 'normal',
      }).success
    ).toBe(true);
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
        proctoringMode: 'relaxed',
      }).success
    ).toBe(false);
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '2026-06-05',
        classId: 'class-1',
      }).success
    ).toBe(false);
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '10:30:00 05/06/2026',
        classId: 'class-1',
      }).success
    ).toBe(false);
  });

  it('validates assessment v2 assignment payloads', () => {
    expect(
      createAssignmentSchema.safeParse({
        title: 'Listening quiz',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
        type: 'quiz',
        assessment: {
          version: 2,
          mode: 'practice',
          sections: [
            {
              id: 'listening',
              title: 'Listening',
              skill: 'listening',
              questions: [
                {
                  id: 'q1',
                  skill: 'listening',
                  prompt: 'What does the speaker want?',
                  responseMode: 'multiple_choice',
                  media: [
                    {
                      id: 'm1',
                      type: 'audio',
                      source: 'external_url',
                      url: 'https://cdn.example.com/q1.mp3',
                    },
                  ],
                  options: [
                    { key: 'A', text: 'A ticket' },
                    { key: 'B', text: 'A book' },
                  ],
                  correctAnswer: 'B',
                },
              ],
            },
          ],
        },
      }).success
    ).toBe(true);

    expect(
      createAssignmentSchema.safeParse({
        title: 'Bad listening quiz',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
        assessment: {
          version: 2,
          sections: [
            {
              id: 'listening',
              title: 'Listening',
              skill: 'listening',
              questions: [
                {
                  id: 'q1',
                  skill: 'listening',
                  prompt: 'Listen.',
                  responseMode: 'multiple_choice',
                  media: [
                    {
                      id: 'm1',
                      type: 'audio',
                      source: 'external_url',
                      url: 'http://cdn.example.com/q1.mp3',
                    },
                  ],
                  options: [
                    { key: 'A', text: 'A ticket' },
                    { key: 'B', text: 'A book' },
                  ],
                },
              ],
            },
          ],
        },
      }).success
    ).toBe(false);

    // Valid deliveryPolicy
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
        deliveryPolicy: {
          targetMode: 'class',
          assignedStudentIds: [],
          availableFrom: '2026-06-12T10:00:00.000Z',
          resultReleasePolicy: 'after_submit',
        },
      }).success
    ).toBe(true);

    // Invalid deliveryPolicy targetMode
    expect(
      createAssignmentSchema.safeParse({
        title: 'Quiz 1',
        dueDate: '2026-06-05T10:30:00.000Z',
        classId: 'class-1',
        deliveryPolicy: {
          targetMode: 'invalid_mode',
          assignedStudentIds: [],
          availableFrom: '',
          resultReleasePolicy: 'after_submit',
        },
      }).success
    ).toBe(false);
  });

  it('requires canonical date-only values for finance dates', () => {
    expect(
      createReceiptSchema.safeParse({
        studentId: 'student-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        amountReceived: 100000,
        receivedDate: '2026-06-05',
      }).success
    ).toBe(true);
    expect(
      createReceiptSchema.safeParse({
        studentId: 'student-1',
        classId: 'class-1',
        ledgerId: 'ledger-1',
        amountReceived: 100000,
        receivedDate: '05/06/2026',
      }).success
    ).toBe(false);
    expect(
      createExpenseSchema.safeParse({
        amount: 100000,
        paidDate: '2026-06-05',
        payee: 'Vendor',
      }).success
    ).toBe(true);
    expect(
      createExpenseSchema.safeParse({
        amount: 100000,
        paidDate: '05/06/2026',
        payee: 'Vendor',
      }).success
    ).toBe(false);
  });

  it('keeps class date and time fields canonical when provided', () => {
    expect(
      createClassSchema.safeParse({
        name: 'Math 6',
        teacherId: 'teacher-1',
        startDate: '2026-06-05',
        endDate: '2026-07-05',
        startTime: '05:09:00',
      }).success
    ).toBe(true);
    expect(
      createClassSchema.safeParse({
        name: 'Math 6',
        teacherId: 'teacher-1',
        startDate: '05/06/2026',
        endDate: '2026-07-05',
        startTime: '05:09:00',
      }).success
    ).toBe(false);
    expect(
      createClassSchema.safeParse({
        name: 'Math 6',
        teacherId: 'teacher-1',
        startDate: '2026-06-05',
        endDate: '2026-07-05',
        startTime: '05:09',
      }).success
    ).toBe(false);
    expect(
      createClassSchema.safeParse({
        name: 'Math 6',
        teacherId: 'teacher-1',
        startDate: '',
        endDate: '',
        startTime: '',
      }).success
    ).toBe(true);
  });

  it('keeps evaluation dates canonical when provided', () => {
    const baseEvaluation = {
      classId: 'class-1',
      studentId: 'student-1',
      scores: { listening: 90 },
      totalScore: 90,
    };

    expect(
      createEvaluationSchema.safeParse({
        ...baseEvaluation,
        date: '2026-06-05',
      }).success
    ).toBe(true);
    expect(
      createEvaluationSchema.safeParse({
        ...baseEvaluation,
        date: '05/06/2026',
      }).success
    ).toBe(false);
    expect(
      createEvaluationSchema.safeParse({
        ...baseEvaluation,
        date: '2026-06-05T10:30:00.000Z',
      }).success
    ).toBe(false);
    expect(
      createEvaluationSchema.safeParse({
        ...baseEvaluation,
        date: '',
      }).success
    ).toBe(true);
  });
});

describe('wallet v2 finance schemas', () => {
  it('accepts a manual receipt with multiple allocations', () => {
    expect(
      createWalletManualReceiptSchema.safeParse({
        flowVersion: 'wallet-manual-v2',
        idempotencyKey: 'receipt-key',
        studentId: 's1',
        amountReceived: 2_000,
        allocations: [
          { ledgerId: 'l1', amount: 900 },
          { ledgerId: 'l2', amount: 600 },
        ],
      }).success
    ).toBe(true);
  });

  it('rejects duplicate ledger allocations', () => {
    expect(
      createWalletManualReceiptSchema.safeParse({
        flowVersion: 'wallet-manual-v2',
        idempotencyKey: 'receipt-key',
        studentId: 's1',
        amountReceived: 2_000,
        allocations: [
          { ledgerId: 'l1', amount: 900 },
          { ledgerId: 'l1', amount: 600 },
        ],
      }).success
    ).toBe(false);
  });

  it('requires a refund reason and positive amount', () => {
    expect(
      createStudentWalletRefundSchema.safeParse({
        idempotencyKey: 'refund-key',
        type: 'wallet_refund',
        studentId: 's1',
        amount: 100,
        paidDate: '2026-07-27',
        payee: 'Phụ huynh học sinh',
        reason: '',
      }).success
    ).toBe(false);
    expect(
      createStudentWalletRefundSchema.safeParse({
        idempotencyKey: 'refund-key',
        type: 'wallet_refund',
        studentId: 's1',
        amount: 0,
        paidDate: '2026-07-27',
        payee: 'Phụ huynh học sinh',
        reason: 'Học sinh nghỉ học',
      }).success
    ).toBe(false);
  });

  it('accepts standalone wallet allocation with an idempotency key', () => {
    expect(
      createWalletAllocationSchema.safeParse({
        idempotencyKey: 'allocation-key',
        studentId: 's1',
        allocations: [{ ledgerId: 'l1', amount: 100 }],
      }).success
    ).toBe(true);
  });

  it('caps manual receipt and standalone allocation requests at 20 ledgers', () => {
    const allocations = Array.from({ length: 21 }, (_, index) => ({
      ledgerId: `l${index}`,
      amount: 1,
    }));
    expect(
      createWalletManualReceiptSchema.safeParse({
        flowVersion: 'wallet-manual-v2',
        idempotencyKey: 'receipt-key',
        studentId: 's1',
        amountReceived: 21,
        allocations,
      }).success
    ).toBe(false);
    expect(
      createWalletAllocationSchema.safeParse({
        idempotencyKey: 'allocation-key',
        studentId: 's1',
        allocations,
      }).success
    ).toBe(false);
  });

  it('requires both a reason and idempotency key for a void', () => {
    expect(
      voidFinanceMutationSchema.safeParse({
        idempotencyKey: 'void-key',
        reason: 'Thu nhầm học sinh',
      }).success
    ).toBe(true);
    expect(voidFinanceMutationSchema.safeParse({ idempotencyKey: '', reason: '' }).success).toBe(
      false
    );
  });
});
