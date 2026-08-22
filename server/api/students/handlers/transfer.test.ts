import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/student/studentIdentityResolver.js', () => ({
  resolveCanonicalStudentId: vi.fn(),
}));

vi.mock('../../lib/student/courseEnrollmentRepository.js', () => ({
  getStudentEnrollments: vi.fn(),
  requireSingleOpenStudentEnrollment: vi.fn(),
  tryResolveClassCurrentTerm: vi.fn(),
}));

vi.mock('../../lib/services/classService.js', () => ({
  assertTeacherClassAccess: vi.fn(),
}));

vi.mock('../../lib/student/studentProgression.js', () => ({
  progressStudentToClass: vi.fn(),
}));

vi.mock('../../lib/services/accountingStudentSummaryService.js', () => ({
  refreshAccountingStudentSummariesAfterCommit: vi.fn(),
}));

vi.mock('../../classes/helpers/courseClosing.js', () => ({
  invalidateCourseClosingApprovals: vi.fn(),
}));

vi.mock('../../lib/student/studentCreation.js', () => ({
  writeStudentAudit: vi.fn(),
}));

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn(),
}));

import { assertTeacherClassAccess } from '../../lib/services/classService.js';
import {
  getStudentEnrollments,
  requireSingleOpenStudentEnrollment,
  tryResolveClassCurrentTerm,
} from '../../lib/student/courseEnrollmentRepository.js';
import { progressStudentToClass } from '../../lib/student/studentProgression.js';
import { resolveCanonicalStudentId } from '../../lib/student/studentIdentityResolver.js';
import { handleTransfer } from './transfer.js';

const openEnrollment = {
  id: 'enrollment-canonical-source',
  studentId: 'canonical-student',
  classId: 'class-source',
  status: 'active',
};

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as ApiResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveCanonicalStudentId).mockResolvedValue({
    requestedId: 'retired-student',
    canonicalProfileId: 'canonical-student',
    resolution: 'profile_alias',
    shouldRedirect: true,
  });
  vi.mocked(getStudentEnrollments).mockResolvedValue([openEnrollment] as never);
  vi.mocked(requireSingleOpenStudentEnrollment).mockReturnValue(openEnrollment as never);
  vi.mocked(assertTeacherClassAccess).mockResolvedValue({
    status: 'active',
    startDate: '2026-09-01',
    endDate: '2026-11-30',
  });
  vi.mocked(tryResolveClassCurrentTerm).mockReturnValue({
    termStart: '2026-09-01',
    termEnd: '2026-11-30',
  });
  vi.mocked(progressStudentToClass).mockResolvedValue({
    profileId: 'canonical-student',
    sourceEnrollmentId: openEnrollment.id,
    targetEnrollmentId: 'enrollment-target',
    targetLedgerId: 'ledger-target',
    sourceStatusBefore: 'active',
    sourceStatusAfter: 'transferred',
    rolloverBalance: 0,
    targetLedgerCreated: true,
    affectedClassIds: ['class-source', 'class-target'],
    idempotencyKey: 'promotion:class-source:class-target:canonical-student:2026-09-01',
    replayed: false,
  });
});

describe('handleTransfer', () => {
  it('derives the source class from the canonical profile open enrollment', async () => {
    const req = {
      method: 'POST',
      body: {
        id: 'retired-student',
        targetClassId: 'class-target',
      },
    } as unknown as ApiRequest;
    const res = makeResponse();
    const db = {
      collection: vi.fn((name: string) => {
        if (name !== 'students') throw new Error(`Unexpected collection: ${name}`);
        return {
          doc: vi.fn((id: string) => ({
            get: vi.fn().mockResolvedValue({
              exists: id === 'canonical-student',
              data: () => ({ name: 'Canonical student', classId: 'legacy-class' }),
            }),
          })),
        };
      }),
    } as never;

    await handleTransfer(
      req,
      res,
      db,
      { uid: 'admin-1' },
      { role: 'admin', name: 'Admin' }
    );

    expect(getStudentEnrollments).toHaveBeenCalledWith(db, 'canonical-student');
    expect(requireSingleOpenStudentEnrollment).toHaveBeenCalledWith([openEnrollment]);
    expect(progressStudentToClass).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        profileId: 'canonical-student',
        sourceClassId: 'class-source',
        targetClassId: 'class-target',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each([
    ['no open enrollment', [], 'a transfer needs an open enrollment'],
    ['multiple open enrollments', [openEnrollment, { ...openEnrollment, id: 'enrollment-other' }], 'multiple open enrollments'],
  ])('returns 409 when the canonical profile has %s', async (_scenario, enrollments, message) => {
    vi.mocked(getStudentEnrollments).mockResolvedValue(enrollments as never);
    vi.mocked(requireSingleOpenStudentEnrollment).mockImplementationOnce(() => {
      throw Object.assign(new Error(`STUDENT_PROGRESSION_SOURCE_INELIGIBLE: ${message}`), {
        statusCode: 409,
      });
    });
    const req = {
      method: 'POST',
      body: { id: 'retired-student', targetClassId: 'class-target' },
    } as unknown as ApiRequest;
    const res = makeResponse();
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ name: 'Canonical student' }),
          }),
        })),
      })),
    } as never;

    await handleTransfer(req, res, db, { uid: 'admin-1' }, { role: 'admin', name: 'Admin' });

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('STUDENT_PROGRESSION_SOURCE_INELIGIBLE'),
      })
    );
    expect(progressStudentToClass).not.toHaveBeenCalled();
  });
});
