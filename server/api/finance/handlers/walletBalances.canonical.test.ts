import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import {
  resetCanonicalStudentReadControlCacheForTests,
  STUDENT_IDENTITY_READ_MODEL_PATH,
} from '../../lib/student/canonicalStudentReadControl.js';
import { makeStudentCourseEnrollmentId } from '../../../../shared/studentCourseEnrollment.js';

const getDbMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth/verifyAuth.js', () => ({ getDb: getDbMock }));

const { handleWallet } = await import('./wallet.js');

type Seed = Record<string, Record<string, unknown>>;

function control(mode: string): Seed {
  return {
    [STUDENT_IDENTITY_READ_MODEL_PATH]: {
      schemaVersion: 1,
      mode,
      generation: 1,
      activatedAt: '2026-08-08T00:00:00.000Z',
      activatedBy: 'admin:tt',
      normalizationRunId: null,
      planDigest: null,
      approvalDigest: null,
    },
  };
}

function enrollment(profileId: string, classId: string, termStart: string, status: string): Seed {
  const id = makeStudentCourseEnrollmentId(profileId, classId, termStart);
  return {
    [`student_course_enrollments/${id}`]: {
      id,
      studentId: profileId,
      classId,
      termStart,
      termEnd: '2026-12-31',
      status,
      joinedAt: termStart,
      endedAt: ['completed', 'transferred', 'dropped'].includes(status) ? '2026-12-31' : null,
      source: 'system',
      confidence: 'confirmed',
    },
  };
}

function alias(legacyId: string, canonicalId: string): Seed {
  return {
    [`student_profile_aliases/${legacyId}`]: {
      legacyProfileId: legacyId,
      canonicalProfileId: canonicalId,
      mergeRunId: 'run-1',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: 't',
      createdBy: 'merge',
    },
  };
}

/**
 * The production shape: one child whose finished G6 profile was retired and
 * whose money now sits on the G7 profile. The wallet list is where an operator
 * decides who owes what, so a second row for the same child is a debt chased
 * twice and a credit nobody can find.
 */
function mergedHumanSeed(mode: string): Seed {
  return {
    ...control(mode),
    'classes/class-g6': { name: 'G6', status: 'archived' },
    'classes/class-g7': { name: 'G7', status: 'active' },
    'students/canonical-1': {
      name: 'Quách Hoàng Minh',
      studentId: 'HS260167',
      classId: 'class-g6',
      enrollmentStatus: 'promoted',
      studentLifecycle: 'enrolled',
      walletBalance: 250_000,
    },
    'students/legacy-1': {
      name: 'Quách Hoàng Minh',
      studentId: 'HS260167',
      classId: 'class-g6',
      enrollmentStatus: 'promoted',
      studentLifecycle: 'enrolled',
      walletBalance: 0,
    },
    ...alias('legacy-1', 'canonical-1'),
    ...enrollment('canonical-1', 'class-g7', '2026-07-01', 'active'),
  };
}

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

type Balances = { students: Array<Record<string, unknown>> };

async function loadBalances(seed: Seed) {
  const { db } = createInMemoryDocumentStore(seed);
  getDbMock.mockReturnValue(db);
  const res = response();
  await handleWallet(
    { method: 'GET', query: {}, headers: {} } as never,
    res as never,
    '',
    'balances',
    'acc-1',
    { role: 'accounting', name: 'KT' }
  );
  return { res, body: res.body as Balances };
}

describe('wallet balances', () => {
  beforeEach(() => {
    resetCanonicalStudentReadControlCacheForTests();
    vi.clearAllMocks();
  });

  it('returns both physical rows in legacy_compare', async () => {
    const { res, body } = await loadBalances(mergedHumanSeed('legacy_compare'));

    expect(res.statusCode).toBe(200);
    expect(body.students.map((student) => student.id).sort()).toEqual([
      'canonical-1',
      'legacy-1',
    ]);
  });

  it('returns one row per human in canonical modes', async () => {
    const { body } = await loadBalances(mergedHumanSeed('canonical_preferred'));

    expect(body.students.map((student) => student.id)).toEqual(['canonical-1']);
    expect(body.students[0]).toMatchObject({ walletBalance: 250_000 });
  });

  it('labels the current class from the open enrollment, not the retired profile field', async () => {
    // The profile still says G6, a class that has been archived. An operator
    // chasing this balance would go to the wrong teacher.
    const { body } = await loadBalances(mergedHumanSeed('canonical_preferred'));

    expect(body.students[0]).toMatchObject({
      classId: 'class-g7',
      className: 'G7',
      classStatus: 'active',
    });
  });

  it('keeps a student with no open enrollment on the list, with no class', async () => {
    // Waiting for placement is not the same as gone. Dropping them from the
    // balance list is how an unpaid debt stops being visible.
    const { body } = await loadBalances({
      ...control('canonical_preferred'),
      'classes/class-g6': { name: 'G6', status: 'archived' },
      'students/waiting': {
        name: 'Chờ Xếp Lớp',
        studentLifecycle: 'enrolled',
        walletBalance: -500_000,
      },
      ...enrollment('waiting', 'class-g6', '2026-01-05', 'completed'),
    });

    expect(body.students.map((student) => student.id)).toEqual(['waiting']);
    expect(body.students[0]).toMatchObject({ classId: '', walletBalance: -500_000 });
  });
});
