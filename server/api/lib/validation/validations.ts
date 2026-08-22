import { z } from 'zod';
import { isApiDateOnly, isApiDateTime, isApiTimeOnly } from '../../../../shared/dateTimeFormat.js';
import { ASSIGNMENT_PROCTORING_MODES } from '../../../../shared/assignmentProctoring.js';
import { assignmentAssessmentInputSchema } from '../../../../shared/assignmentAssessment.js';
import {
  ASSIGNMENT_TARGET_MODES,
  ASSIGNMENT_RESULT_RELEASE_POLICIES,
} from '../../../../shared/assignmentDelivery.js';

export const apiDateOnlySchema = z.string().refine(isApiDateOnly, 'Invalid date format');
export const apiTimeOnlySchema = z.string().refine(isApiTimeOnly, 'Invalid time format');
export const apiDateTimeSchema = z.string().refine(isApiDateTime, 'Invalid datetime format');

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const optionalApiDateOnlySchema = z.preprocess(
  emptyStringToUndefined,
  apiDateOnlySchema.optional()
);
export const optionalApiTimeOnlySchema = z.preprocess(
  emptyStringToUndefined,
  apiTimeOnlySchema.optional()
);

// ─── Students ────────────────────────────────────────────────────────────────
export const createStudentSchema = z.object({
  name: z.string().min(1, 'Missing name').max(200),
  dob: apiDateOnlySchema,
  contact: z.string().min(1, 'Missing contact').max(200),
  classId: z.string().min(1, 'Missing classId'),
  faceImage: z.string().optional(),
  faceImageStoragePath: z.string().optional(),
  code: z.string().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  grade: z.number().int().min(1).max(12).optional(),
  joinedAt: optionalApiDateOnlySchema,
});

export const updateStudentSchema = createStudentSchema.extend({
  id: z.string().min(1, 'Missing student id'),
  studentId: z.string().min(1).optional(),
});

export const studentStatusSchema = z.object({
  id: z.string().min(1, 'Missing student id'),
  enrollmentStatus: z.enum(['active', 'on_leave', 'dropped', 'promoted']),
  statusNote: z.string().optional(),
});

export const siblingLinkSchema = z.object({
  op: z.enum(['link', 'unlink']),
  studentId: z.string().min(1),
  siblingId: z.string().optional(),
  confirmMerge: z.boolean().optional(),
});

export const admissionAddToWaitlistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  dob: apiDateOnlySchema,
  contact: z.string().min(1, 'Contact is required').max(200),
  grade: z.number().int().min(1).max(12).optional(),
  note: z.string().max(1000).optional(),
});

export const admissionDeletePendingSchema = z.object({
  studentId: z.string().min(1, 'Missing student id'),
});

export const admissionCreateTrialSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    dob: apiDateOnlySchema.optional(),
    contact: z.string().min(1).max(200).optional(),
    grade: z.number().int().min(1).max(12).optional(),
    classId: z.string().min(1, 'Missing class id'),
    selectedHistoricalStudentId: z.string().optional(),
    pendingStudentId: z.string().optional(),
    note: z.string().max(1000).optional(),
    joinedAt: optionalApiDateOnlySchema,
  })
  .superRefine((data, ctx) => {
    if (!data.pendingStudentId) {
      if (!data.name || !data.name.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'Name is required when creating trial directly',
        });
      }
      if (!data.dob || !isApiDateOnly(data.dob)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dob'],
          message: 'Valid DOB is required when creating trial directly',
        });
      }
      if (!data.contact || !data.contact.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contact'],
          message: 'Contact is required when creating trial directly',
        });
      }
      if (data.grade === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['grade'],
          message: 'Grade is required when creating trial directly',
        });
      }
    }
  });

export const admissionSearchSchema = z.object({
  name: z.string().min(1).max(200),
  dob: apiDateOnlySchema,
  contact: z.string().min(1).max(200),
});

export const trialDecisionSchema = z.object({
  studentId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
  note: z.string().max(1000).optional(),
});

// ─── Classes ─────────────────────────────────────────────────────────────────
const weeklyClassSessionSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: apiTimeOnlySchema,
    endTime: apiTimeOnlySchema,
    room: z.string().max(200).optional(),
  })
  .refine((session) => session.endTime > session.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });

const weeklySessionsSchema = z
  .array(weeklyClassSessionSchema)
  .optional()
  .refine((sessions) => {
    if (!sessions) return true;
    return new Set(sessions.map((session) => session.dayOfWeek)).size === sessions.length;
  }, 'Duplicate weekly session weekday');

export const createClassSchema = z.object({
  name: z.string().min(1, 'Missing class name').max(200),
  teacherId: z.string().min(1, 'Missing teacherId'),
  schedule: z.string().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  description: z.string().optional(),
  startDate: optionalApiDateOnlySchema,
  endDate: optionalApiDateOnlySchema,
  startTime: optionalApiTimeOnlySchema,
  room: z.string().optional(),
  salaryPerSession: z.number().min(0).optional(),
  tuitionFee: z.number().min(0).optional(),
  grade: z.number().int().min(1).max(12).optional(),
  importSourceClassId: z.string().optional(),
  weeklySessions: weeklySessionsSchema,
});

export const updateClassSchema = createClassSchema.extend({
  id: z.string().min(1, 'Missing class id'),
});

// ─── Attendance ──────────────────────────────────────────────────────────────
export const attendanceToggleSchema = z
  .object({
    classId: z.string().min(1),
    studentId: z.string().min(1),
    date: apiDateOnlySchema,
    status: z.enum(['present', 'absent', 'late']),
    eligibilityOverride: z.boolean().optional(),
    overrideReason: z.string().trim().min(3).max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.eligibilityOverride === true && !val.overrideReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'overrideReason is required when eligibilityOverride is true',
        path: ['overrideReason'],
      });
    }
    if (val.eligibilityOverride !== true && val.overrideReason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'overrideReason can only be provided when eligibilityOverride is true',
        path: ['overrideReason'],
      });
    }
  });

export const attendanceCycleSchema = z.object({
  classId: z.string().min(1),
  studentId: z.string().min(1),
  date: apiDateOnlySchema,
});

export const attendanceBulkToggleSchema = z.object({
  classId: z.string().min(1),
  date: apiDateOnlySchema,
  status: z.enum(['present', 'absent', 'late']),
  studentIds: z.array(z.string().min(1)).min(1).max(100),
});

// ─── Evaluations ─────────────────────────────────────────────────────────────
export const createEvaluationSchema = z.object({
  classId: z.string().min(1),
  studentId: z.string().min(1),
  evaluationType: z.string().optional(),
  scores: z.record(z.string(), z.union([z.number().min(0).max(100), z.literal('')])),
  totalScore: z.number().min(0).max(100),
  positivePoints: z.array(z.string()).optional(),
  improvementPoints: z.string().optional(),
  finalScore: z.number().min(0).max(100).nullable().optional(),
  rank: z.enum(['none', 'first', 'second']).optional(),
  date: optionalApiDateOnlySchema,
});

const assignmentDeliveryPolicySchema = z
  .object({
    targetMode: z.enum(ASSIGNMENT_TARGET_MODES),
    assignedStudentIds: z.array(z.string().min(1)).default([]),
    availableFrom: z.string().default(''),
    resultReleasePolicy: z.enum(ASSIGNMENT_RESULT_RELEASE_POLICIES),
  })
  .optional();

// ─── Assignments ─────────────────────────────────────────────────────────────
export const createAssignmentSchema = z.object({
  title: z.string().min(1, 'Missing title').max(500),
  description: z.string().optional(),
  dueDate: apiDateTimeSchema,
  classId: z.string().min(1, 'Missing classId'),
  type: z.enum(['essay', 'quiz']).optional(),
  questions: z.array(z.unknown()).optional(),
  attemptsAllowed: z.number().int().min(1).max(10).optional(),
  proctoringMode: z.enum(ASSIGNMENT_PROCTORING_MODES).optional(),
  assessment: assignmentAssessmentInputSchema.optional(),
  deliveryPolicy: assignmentDeliveryPolicySchema,
});

export const submitAssignmentSchema = z.object({
  assignmentId: z.string().min(1),
  content: z.string().optional(),
  quizAnswers: z
    .array(
      z.object({
        questionId: z.union([z.string(), z.number()]),
        selectedOption: z.string(),
      })
    )
    .optional(),
});

// ─── Finance ─────────────────────────────────────────────────────────────────
export const createReceiptSchema = z.object({
  studentId: z.string().min(1),
  classId: z.string().min(1),
  ledgerId: z.string().min(1),
  amountReceived: z.number().min(0),
  paymentMethod: z.string().optional(),
  receivedDate: apiDateOnlySchema.optional(),
  note: z.string().optional(),
  discountType: z
    .enum(['none', 'first_prize', 'second_prize', 'full_waiver', 'hardship', 'custom'])
    .optional(),
  discountAmount: z.number().min(0).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountReason: z.string().optional(),
  originalAmount: z.number().min(0).optional(),
  siblingDiscount: z.boolean().optional(),
  siblingDiscountWaived: z.boolean().optional(),
  siblingDiscountWaivedReason: z.string().max(500).optional(),
});

export const createWalletDepositSchema = z.object({
  studentId: z.string().min(1),
  amountReceived: z.number().positive(),
  paymentMethod: z.string().optional(),
  receivedDate: apiDateOnlySchema.optional(),
  note: z.string().max(1000).optional(),
});

const receiptAllocationSchema = z
  .object({
    ledgerId: z.string().min(1),
    amount: z.number().min(0),
    discountType: z
      .enum(['none', 'first_prize', 'second_prize', 'full_waiver', 'hardship', 'custom'])
      .optional(),
    discountAmount: z.number().min(0).optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    discountReason: z.string().max(500).optional(),
    siblingDiscount: z.boolean().optional(),
    siblingDiscountWaived: z.boolean().optional(),
    siblingDiscountWaivedReason: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.amount <= 0 && value.discountType !== 'full_waiver') {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Allocation amount must be positive unless this is a full waiver',
      });
    }
  });

function rejectDuplicateLedgers(
  value: { allocations: Array<{ ledgerId: string }> },
  ctx: z.RefinementCtx
) {
  const ids = value.allocations.map((allocation) => allocation.ledgerId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate ledger allocation' });
  }
}

export const createWalletManualReceiptSchema = z
  .object({
    flowVersion: z.literal('wallet-manual-v2'),
    idempotencyKey: z.string().min(1).max(200),
    studentId: z.string().min(1),
    amountReceived: z.number().min(0),
    allocations: z.array(receiptAllocationSchema).max(20),
    paymentMethod: z.string().optional(),
    receivedDate: apiDateOnlySchema.optional(),
    note: z.string().max(1000).optional(),
  })
  .superRefine(rejectDuplicateLedgers);

export const createWalletAllocationSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    studentId: z.string().min(1),
    allocations: z
      .array(
        z.object({
          ledgerId: z.string().min(1),
          amount: z.number().positive(),
        })
      )
      .min(1)
      .max(20),
  })
  .superRefine(rejectDuplicateLedgers);

export const createStudentWalletRefundSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  type: z.literal('wallet_refund'),
  studentId: z.string().min(1),
  amount: z.number().positive(),
  paidDate: apiDateOnlySchema,
  payee: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
  note: z.string().max(1000).optional(),
});

export const voidFinanceMutationSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
});

export type CreateWalletManualReceiptInput = z.infer<typeof createWalletManualReceiptSchema>;
export type VoidFinanceMutationInput = z.infer<typeof voidFinanceMutationSchema>;

export const createExpenseSchema = z.object({
  category: z.string().optional(),
  amount: z.number().positive(),
  paidDate: apiDateOnlySchema,
  payee: z.string().min(1, 'Missing payee'),
  note: z.string().optional(),
  purpose: z.string().optional(),
});

// ─── Validation helper ───────────────────────────────────────────────────────
export type ValidationResult<T> = { success: true; data: T } | { success: false; error: string };

export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): ValidationResult<T> {
  const result = schema.safeParse(body);
  if (result.success) return { success: true, data: result.data };
  const message = result.error.issues.map((e) => e.message).join('; ');
  return { success: false, error: message };
}
