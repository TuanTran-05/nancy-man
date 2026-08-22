import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSiblings, resolveSiblingGroupAssignment } from './siblings.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    serverTimestamp: () => 'serverTimestamp',
    delete: () => 'delete',
  },
}));

vi.mock('../../lib/student/studentCreation.js', () => ({
  writeStudentAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/realtime/events.js', () => ({
  touchRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

const defaults = { newGroupId: 'fresh', confirmMerge: false };

describe('resolveSiblingGroupAssignment', () => {
  it('mints a new group when neither student has one', () => {
    expect(
      resolveSiblingGroupAssignment({ ...defaults, studentGroupId: '', siblingGroupId: '' })
    ).toEqual({ groupId: 'fresh', merged: false });
  });

  it('joins the sibling to the student group', () => {
    expect(
      resolveSiblingGroupAssignment({ ...defaults, studentGroupId: 'g1', siblingGroupId: '' })
    ).toEqual({ groupId: 'g1', merged: false });
  });

  it('joins the student to the sibling group', () => {
    expect(
      resolveSiblingGroupAssignment({ ...defaults, studentGroupId: '', siblingGroupId: 'g2' })
    ).toEqual({ groupId: 'g2', merged: false });
  });

  it('is a no-op when both already share a group', () => {
    expect(
      resolveSiblingGroupAssignment({ ...defaults, studentGroupId: 'g1', siblingGroupId: 'g1' })
    ).toEqual({ groupId: 'g1', merged: false });
  });

  it('refuses to merge two different groups without confirmation', () => {
    expect(() =>
      resolveSiblingGroupAssignment({ ...defaults, studentGroupId: 'g1', siblingGroupId: 'g2' })
    ).toThrow('merge_confirmation_required');
  });

  it('merges into the student group once confirmed', () => {
    expect(
      resolveSiblingGroupAssignment({
        ...defaults,
        studentGroupId: 'g1',
        siblingGroupId: 'g2',
        confirmMerge: true,
      })
    ).toEqual({ groupId: 'g1', merged: true });
  });
});

function alias(legacyId: string, canonicalId: string) {
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

function response() {
  const res = {
    statusCode: 0,
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

function request(body: Record<string, unknown>) {
  return { method: 'POST', headers: {}, body } as never;
}

const USER = { uid: 'admin-1' };
const USER_INFO = { role: 'admin', name: 'Admin' };

describe('sibling links resolve identity before writing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('links the surviving profile when a caller passes a retired id', async () => {
    // A sibling link stamped on a retired document is invisible: the family
    // looks linked to whoever wrote it and unlinked to everyone reading the
    // canonical profile.
    const { db, store, writeLog } = createInMemoryDocumentStore({
      'students/canonical-1': { name: 'Anh' },
      'students/legacy-1': { name: 'Anh (cũ)' },
      ...alias('legacy-1', 'canonical-1'),
      'students/sibling-1': { name: 'Em' },
    });
    const res = response();

    await handleSiblings(
      request({ op: 'link', studentId: 'legacy-1', siblingId: 'sibling-1' }),
      res as never,
      db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(200);
    expect(writeLog).not.toContain('students/legacy-1');
    expect(store.get('students/canonical-1')?.siblingGroupId).toBeTruthy();
    expect(store.get('students/canonical-1')?.siblingGroupId).toBe(
      store.get('students/sibling-1')?.siblingGroupId
    );
  });

  it('refuses a link between two ids that are the same human', async () => {
    // The raw string compare passes here: the two ids differ. Only resolution
    // reveals that this would make a child their own sibling.
    const { db, writeLog } = createInMemoryDocumentStore({
      'students/canonical-1': { name: 'Anh' },
      'students/legacy-1': { name: 'Anh (cũ)' },
      ...alias('legacy-1', 'canonical-1'),
    });
    const res = response();

    await handleSiblings(
      request({ op: 'link', studentId: 'canonical-1', siblingId: 'legacy-1' }),
      res as never,
      db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('own sibling') });
    expect(writeLog).toEqual([]);
  });

  it('unlinks through the surviving profile too', async () => {
    const { db, writeLog } = createInMemoryDocumentStore({
      'students/canonical-1': { name: 'Anh', siblingGroupId: 'sib_1' },
      'students/legacy-1': { name: 'Anh (cũ)' },
      ...alias('legacy-1', 'canonical-1'),
      'students/sibling-1': { name: 'Em', siblingGroupId: 'sib_1' },
    });
    const res = response();

    await handleSiblings(
      request({ op: 'unlink', studentId: 'legacy-1' }),
      res as never,
      db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(200);
    expect(writeLog).toContain('students/canonical-1');
    expect(writeLog).not.toContain('students/legacy-1');
  });

  it('returns 404 for an id that resolves to nothing', async () => {
    const { db } = createInMemoryDocumentStore({ 'students/sibling-1': { name: 'Em' } });
    const res = response();

    await handleSiblings(
      request({ op: 'link', studentId: 'ghost', siblingId: 'sibling-1' }),
      res as never,
      db,
      USER,
      USER_INFO
    );

    expect(res.statusCode).toBe(404);
  });
});
