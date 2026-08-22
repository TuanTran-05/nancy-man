/**
 * End-to-end contract flow for the course-closing gate.
 *
 * One in-memory DocumentStore backs the real class and Zalo route handlers so the
 * same canonical snapshot drives status, sends, exemption and reset.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import classesHandler from '../server/api/classes/route';
import { getDb, verifyAuthToken, verifyAuthContext } from '../server/api/lib/auth/verifyAuth.js';
import { sendZaloZNSMessage } from '../server/api/lib/zalo/zaloHelper.js';
import { makeStudentCourseEnrollmentId } from '../shared/studentCourseEnrollment.js';

vi.mock('../server/api/lib/http/cors.js', () => ({
  handleCorsPreflight: vi.fn(() => false),
  setCorsHeaders: vi.fn(),
}));

vi.mock('../server/api/lib/auth/verifyAuth.js', () => ({
  getDb: vi.fn(),
  verifyAuthToken: vi.fn(),
  verifyAuthContext: vi.fn(),
}));

vi.mock('../server/api/lib/zalo/zaloHelper.js', () => ({
  getZaloConfig: vi.fn(() => ({
    appId: 'app-id',
    appSecret: 'app-secret',
    oaId: 'oa-id',
    znsEvalTemplateId: 'eval-template',
    znsRankTemplateId: 'rank-template',
    znsTuitionNoticeTemplateId: 'tuition-notice-template',
    znsNextCourseTuitionTemplateId: 'next-course-tuition-template',
  })),
  sendZaloZNSMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
  checkZaloConnection: vi.fn().mockResolvedValue({ configured: true, connected: true }),
}));

vi.mock('../server/api/lib/logging/auditLog.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  writeOptionalAuditLog: vi.fn(),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../server/api/lib/auth/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 19 }),
  enforceRateLimit: vi.fn().mockResolvedValue(true),
  isDuplicateWithinWindow: vi.fn().mockResolvedValue(false),
  markRecord: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/api/lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/db/documentStore.js', () => ({
  FieldPath: { documentId: vi.fn(() => '__name__') },
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
    delete: vi.fn(() => '__delete__'),
  },
}));

// ─── Minimal in-memory DocumentStore ──────────────────────────────────────────────

type Doc = { id: string; data: Record<string, unknown>; updateTime: string };
type Store = Record<string, Map<string, Doc>>;

const DEFAULT_UPDATE_TIME = '2026-06-30T10:00:00.000Z';

function snapshotOf(collection: string, doc: Doc | undefined, id: string) {
  return {
    id,
    exists: Boolean(doc),
    ref: { id, path: `${collection}/${id}`, collectionName: collection },
    updateTime: { toDate: () => new Date(doc?.updateTime ?? DEFAULT_UPDATE_TIME) },
    data: () => (doc ? { ...doc.data } : undefined),
  };
}

function matches(data: Record<string, unknown>, constraints: Array<[string, string, unknown]>) {
  return constraints.every(([field, op, value]) => {
    const actual = data[field];
    if (op === '==') return actual === value;
    if (op === 'in') return Array.isArray(value) && value.includes(actual);
    if (op === '!=') return actual !== value;
    return true;
  });
}

function createStore(): { store: Store; db: any } {
  const store: Store = {
    classes: new Map(),
    students: new Map(),
    evaluations: new Map(),
    zalo_notifications: new Map(),
    users: new Map(),
    course_fee_ledgers: new Map(),
  };

  const collectionOf = (name: string) => {
    if (!store[name]) store[name] = new Map();
    return store[name];
  };

  const applyWrite = (
    collection: string,
    id: string,
    data: Record<string, unknown>,
    merge: boolean
  ) => {
    const map = collectionOf(collection);
    const current = map.get(id);
    const next = merge && current ? { ...current.data } : {};
    for (const [key, value] of Object.entries(data)) {
      if (value === '__delete__') delete next[key];
      else next[key] = value;
    }
    map.set(id, { id, data: next, updateTime: current?.updateTime ?? DEFAULT_UPDATE_TIME });
  };

  const makeDocRef = (collection: string, id: string): any => ({
    id,
    path: `${collection}/${id}`,
    collectionName: collection,
    get: async () => snapshotOf(collection, collectionOf(collection).get(id), id),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) =>
      applyWrite(collection, id, data, Boolean(options?.merge)),
    update: async (data: Record<string, unknown>) => applyWrite(collection, id, data, true),
    delete: async () => collectionOf(collection).delete(id),
  });

  const makeQuery = (collection: string, constraints: Array<[string, string, unknown]> = []): any => ({
    where: (field: string, op: string, value: unknown) =>
      makeQuery(collection, [...constraints, [field, op, value]]),
    orderBy: () => makeQuery(collection, constraints),
    limit: () => makeQuery(collection, constraints),
    doc: (id: string) => makeDocRef(collection, id),
    get: async () => {
      const docs = [...collectionOf(collection).values()]
        .filter((doc) => matches(doc.data, constraints))
        .map((doc) => snapshotOf(collection, doc, doc.id));
      return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
    },
  });

  const db: any = {
    collection: (name: string) => makeQuery(name),
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        get: async (target: any) => target.get(),
        create: (ref: any, data: Record<string, unknown>) => {
          if (collectionOf(ref.collectionName).has(ref.id)) {
            throw new Error(`already exists: ${ref.path}`);
          }
          applyWrite(ref.collectionName, ref.id, data, false);
          return tx;
        },
        set: (ref: any, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          applyWrite(ref.collectionName, ref.id, data, Boolean(options?.merge));
          return tx;
        },
        update: (ref: any, data: Record<string, unknown>) => {
          applyWrite(ref.collectionName, ref.id, data, true);
          return tx;
        },
        delete: (ref: any) => {
          collectionOf(ref.collectionName).delete(ref.id);
          return tx;
        },
      };
      return callback(tx);
    },
    batch: () => {
      const ops: Array<() => void> = [];
      const created: Array<{ collection: string; id: string; path: string }> = [];
      const batch: any = {
        create: (ref: any, data: Record<string, unknown>) => {
          created.push({ collection: ref.collectionName, id: ref.id, path: ref.path });
          ops.push(() => applyWrite(ref.collectionName, ref.id, data, false));
          return batch;
        },
        set: (ref: any, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          ops.push(() => applyWrite(ref.collectionName, ref.id, data, Boolean(options?.merge)));
          return batch;
        },
        update: (ref: any, data: Record<string, unknown>) => {
          ops.push(() => applyWrite(ref.collectionName, ref.id, data, true));
          return batch;
        },
        delete: (ref: any) => {
          ops.push(() => collectionOf(ref.collectionName).delete(ref.id));
          return batch;
        },
        // DocumentStore rejects the whole commit when any create hits an existing
        // doc, so every precondition is checked before a single write lands.
        commit: async () => {
          for (const pending of created) {
            if (collectionOf(pending.collection).has(pending.id)) {
              throw new Error(`already exists: ${pending.path}`);
            }
          }
          ops.forEach((op) => op());
        },
      };
      return batch;
    },
  };

  return { store, db };
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    setHeader: vi.fn(),
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    end: vi.fn(),
  };
  return res;
}

// ─── Scenario ─────────────────────────────────────────────────────────────────

const RESET_OPERATION_ID = 'ecfc1d25-f4fd-45f7-a094-af82501ae7c6';

function createScenario() {
  const { store, db } = createStore();
  vi.mocked(getDb).mockReturnValue(db);

  store.users.set('teacher-1', { id: 'teacher-1', data: { role: 'teacher' }, updateTime: DEFAULT_UPDATE_TIME });
  store.users.set('admin-1', { id: 'admin-1', data: { role: 'admin' }, updateTime: DEFAULT_UPDATE_TIME });
  store.users.set('office-1', { id: 'office-1', data: { role: 'office' }, updateTime: DEFAULT_UPDATE_TIME });

  store.classes.set('class-1', {
    id: 'class-1',
    updateTime: DEFAULT_UPDATE_TIME,
    data: {
      name: 'Class A',
      teacherId: 'teacher-1',
      status: 'active',
      currentCourseId: 'course-1',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      tuitionFee: 1000000,
      terms: [],
    },
  });

  for (const studentId of ['student-1', 'student-2']) {
    store.students.set(studentId, {
      id: studentId,
      updateTime: DEFAULT_UPDATE_TIME,
      data: {
        classId: 'class-1',
        enrollmentStatus: 'active',
        name: `Student ${studentId}`,
        contact: '0384072314',
      },
    });
    // The course roster comes from enrollments now. `students.classId` points
    // at whatever class a student is in today, so closing a finished course
    // asked the wrong question of it.
    const enrollmentId = makeStudentCourseEnrollmentId(studentId, 'class-1', '2026-06-01');
    store.student_course_enrollments = store.student_course_enrollments || new Map();
    store.student_course_enrollments.set(enrollmentId, {
      id: enrollmentId,
      updateTime: DEFAULT_UPDATE_TIME,
      data: {
        id: enrollmentId,
        studentId,
        classId: 'class-1',
        termStart: '2026-06-01',
        termEnd: '2026-06-30',
        status: 'active',
        joinedAt: '2026-06-01',
        endedAt: null,
        statusReason: null,
        source: 'system',
        confidence: 'confirmed',
        statusChangedAt: '2026-06-01T00:00:00.000Z',
        statusChangedBy: 'seed',
        confirmedAt: '2026-06-01T00:00:00.000Z',
        confirmedBy: 'seed',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    });
  }

  // student-1 has a final evaluation; student-2 does not yet.
  store.evaluations.set('evaluation-1', {
    id: 'evaluation-1',
    updateTime: '2026-06-30T08:00:00.000Z',
    data: {
      classId: 'class-1',
      studentId: 'student-1',
      evaluationType: 'final',
      date: '2026-06-30',
      finalScore: 9,
    },
  });

  const authAs = (uid: string) => {
    vi.mocked(verifyAuthToken).mockResolvedValue({ uid, email: `${uid}@test.com` } as any);
    vi.mocked(verifyAuthContext).mockResolvedValue({
      decoded: { uid, email: `${uid}@test.com` },
      context: { role: String(store.users.get(uid)?.data.role), name: uid, uid },
    } as any);
  };

  const invoke = async (handler: any, action: string, options: any = {}) => {
    const res = mockRes();
    await handler(
      {
        method: options.method ?? 'POST',
        headers: {},
        query: { action, ...(options.query || {}) },
        body: options.body,
      } as any,
      res
    );
    return res;
  };

  const status = async () => {
    authAs('office-1');
    const res = await invoke(classesHandler, 'course-closing-status', {
      method: 'GET',
      query: { classId: 'class-1' },
    });
    if (!res.body?.courseClosing) {
      throw new Error('status failed: ' + res.statusCode + ' ' + JSON.stringify(res.body));
    }
    return res.body.courseClosing;
  };

  return {
    store,
    db,
    authAs,
    invoke,
    status,
    saveFinalEvaluationForStudentTwo() {
      store.evaluations.set('evaluation-2', {
        id: 'evaluation-2',
        updateTime: '2026-06-30T09:00:00.000Z',
        data: {
          classId: 'class-1',
          studentId: 'student-2',
          evaluationType: 'final',
          date: '2026-06-30',
          finalScore: 8,
        },
      });
    },
    recordSend(studentId: string, type: string, extra: Record<string, unknown> = {}) {
      const id = `${type}-${studentId}`;
      store.zalo_notifications.set(id, {
        id,
        updateTime: DEFAULT_UPDATE_TIME,
        data: {
          classId: 'class-1',
          studentId,
          courseId: String(store.classes.get('class-1')?.data.currentCourseId),
          type,
          status: 'sent',
          ...extra,
        },
      });
    },
    async teacherApproves() {
      this.authAs('teacher-1');
      return this.invoke(classesHandler, 'approve-course-closing', {
        body: { classId: 'class-1' },
      });
    },
    async reset(operationId = RESET_OPERATION_ID) {
      this.authAs('admin-1');
      return this.invoke(classesHandler, 'reset-course', {
        body: {
          classId: 'class-1',
          startDate: '2026-07-01',
          endDate: '2026-07-31',
          operationId,
        },
      });
    },
  };
}

describe('course closing end-to-end flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendZaloZNSMessage).mockResolvedValue({ success: true, messageId: 'msg-1' } as any);
  });

  it('moves one course from evaluations through approval, sends, completion and reset', async () => {
    const scenario = createScenario();

    // 1. One student is still missing a final evaluation.
    expect((await scenario.status()).status).toBe('missing_evaluations');

    // Office cannot send and Admin cannot reset while evaluations are missing.
    const blockedReset = await scenario.reset();
    expect(blockedReset.statusCode).toBe(409);
    expect(blockedReset.body.errorCode).toBe('COURSE_CLOSING_INCOMPLETE');

    // 2. Teacher saves the last final evaluation.
    scenario.saveFinalEvaluationForStudentTwo();
    expect((await scenario.status()).status).toBe('ready_for_approval');

    // Office is still blocked before approval.
    expect((await scenario.status()).approvalValid).toBe(false);

    // 3. Teacher approves.
    const approved = await scenario.teacherApproves();
    expect(approved.statusCode).toBe(200);
    expect((await scenario.status()).status).toBe('approved');

    // 4. Office completes every required send.
    for (const studentId of ['student-1', 'student-2']) {
      const evaluationId = studentId === 'student-1' ? 'evaluation-1' : 'evaluation-2';
      const version = studentId === 'student-1'
        ? '2026-06-30T08:00:00.000Z'
        : '2026-06-30T09:00:00.000Z';
      scenario.recordSend(studentId, 'evaluation_notice', {
        evaluationId,
        evaluationVersion: version,
      });
      scenario.recordSend(studentId, 'tuition_notice');
    }

    // 5. Snapshot is completed.
    const completed = await scenario.status();
    expect(completed.status).toBe('completed');
    expect(completed.pendingEvaluationStudentIds).toEqual([]);
    expect(completed.pendingTuitionStudentIds).toEqual([]);

    // 6. Reset succeeds and rotates the course.
    const reset = await scenario.reset();
    expect(reset.statusCode).toBe(200);

    const classData = scenario.store.classes.get('class-1')!.data;
    const terms = classData.terms as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ courseId: 'course-1', resetOperationId: RESET_OPERATION_ID });
    expect(terms[0].id).not.toBe('course-1');
    expect(classData.currentCourseId).not.toBe('course-1');
    expect(classData.courseClosing).toBeUndefined();

    // Evaluations follow the archived term, not the new course.
    expect(scenario.store.evaluations.get('evaluation-1')!.data.termId).toBe(terms[0].id);

    // Ledgers for the new course exist exactly once per required student.
    expect(scenario.store.course_fee_ledgers.size).toBe(2);

    // 7. The new course is locked again.
    const afterReset = await scenario.status();
    expect(afterReset.courseId).toBe(classData.currentCourseId);
    expect(afterReset.approvalValid).toBe(false);
  });

  it('retrying the same operationId does not duplicate the term or the ledgers', async () => {
    const scenario = createScenario();
    scenario.saveFinalEvaluationForStudentTwo();
    await scenario.teacherApproves();
    for (const studentId of ['student-1', 'student-2']) {
      const evaluationId = studentId === 'student-1' ? 'evaluation-1' : 'evaluation-2';
      const version = studentId === 'student-1'
        ? '2026-06-30T08:00:00.000Z'
        : '2026-06-30T09:00:00.000Z';
      scenario.recordSend(studentId, 'evaluation_notice', {
        evaluationId,
        evaluationVersion: version,
      });
      scenario.recordSend(studentId, 'tuition_notice');
    }

    const first = await scenario.reset();
    const rotatedCourseId = scenario.store.classes.get('class-1')!.data.currentCourseId;
    const ledgersAfterFirst = scenario.store.course_fee_ledgers.size;

    const second = await scenario.reset();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((scenario.store.classes.get('class-1')!.data.terms as unknown[]).length).toBe(1);
    expect(scenario.store.classes.get('class-1')!.data.currentCourseId).toBe(rotatedCourseId);
    expect(scenario.store.course_fee_ledgers.size).toBe(ledgersAfterFirst);
  });

  it('a course-date change makes an existing approval stale and reblocks reset', async () => {
    const scenario = createScenario();
    scenario.saveFinalEvaluationForStudentTwo();
    await scenario.teacherApproves();
    expect((await scenario.status()).approvalValid).toBe(true);

    // Change the course dates directly, mimicking a class update.
    const classDoc = scenario.store.classes.get('class-1')!;
    classDoc.data.endDate = '2026-07-15';

    const stale = await scenario.status();
    expect(stale.status).toBe('stale');
    expect(stale.approvalValid).toBe(false);

    const blocked = await scenario.reset();
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.errorCode).toBe('COURSE_CLOSING_INCOMPLETE');
    expect((scenario.store.classes.get('class-1')!.data.terms as unknown[]).length).toBe(0);
  });

  it('an Admin exemption completes a student that cannot be reached', async () => {
    const scenario = createScenario();
    scenario.saveFinalEvaluationForStudentTwo();
    await scenario.teacherApproves();

    // Only student-1 can actually be sent to.
    scenario.recordSend('student-1', 'evaluation_notice', {
      evaluationId: 'evaluation-1',
      evaluationVersion: '2026-06-30T08:00:00.000Z',
    });
    scenario.recordSend('student-1', 'tuition_notice');

    scenario.authAs('admin-1');
    const exempted = await scenario.invoke(classesHandler, 'exempt-course-closing-student', {
      body: {
        classId: 'class-1',
        studentId: 'student-2',
        reason: 'Không còn kênh liên hệ hợp lệ',
      },
    });

    expect(exempted.statusCode).toBe(200);
    const snapshot = await scenario.status();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.exemptStudentCount).toBe(1);

    const reset = await scenario.reset();
    expect(reset.statusCode).toBe(200);
  });

  it('a blocked reset writes no class, evaluation or ledger data', async () => {
    const scenario = createScenario();
    const before = {
      classData: JSON.stringify(scenario.store.classes.get('class-1')!.data),
      evaluations: JSON.stringify([...scenario.store.evaluations.values()]),
      ledgers: scenario.store.course_fee_ledgers.size,
    };

    const res = await scenario.reset();

    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(scenario.store.classes.get('class-1')!.data)).toBe(before.classData);
    expect(JSON.stringify([...scenario.store.evaluations.values()])).toBe(before.evaluations);
    expect(scenario.store.course_fee_ledgers.size).toBe(before.ledgers);
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('an office user cannot approve and a non-admin cannot exempt', async () => {
    const scenario = createScenario();
    scenario.saveFinalEvaluationForStudentTwo();

    scenario.authAs('office-1');
    const approved = await scenario.invoke(classesHandler, 'approve-course-closing', {
      body: { classId: 'class-1' },
    });
    expect(approved.statusCode).toBe(403);

    await scenario.teacherApproves();

    scenario.authAs('office-1');
    const exempted = await scenario.invoke(classesHandler, 'exempt-course-closing-student', {
      body: { classId: 'class-1', studentId: 'student-2', reason: 'x' },
    });
    expect(exempted.statusCode).toBe(403);
  });
});
