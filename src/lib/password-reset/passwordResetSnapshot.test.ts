import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPasswordResetSnapshot,
  getPasswordResetSnapshot,
  setPasswordResetSnapshot,
} from './passwordResetSnapshot';
import type { PasswordResetRequest } from '../../types';

const TEACHER = { uid: 'teacher-1', role: 'teacher' };
const OTHER_TEACHER = { uid: 'teacher-2', role: 'teacher' };
const SAME_UID_OTHER_ROLE = { uid: 'teacher-1', role: 'office' };

function request(id: string, overrides: Partial<PasswordResetRequest> = {}): PasswordResetRequest {
  return {
    id,
    userId: 'student-1',
    studentDocId: 'doc-1',
    type: 'student',
    teacherId: 'teacher-1',
    studentName: 'Student 1',
    phoneNumber: '0123456789',
    status: 'pending',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('passwordResetSnapshot', () => {
  beforeEach(() => {
    clearPasswordResetSnapshot();
  });

  it('returns null when no snapshot is set', () => {
    expect(getPasswordResetSnapshot(TEACHER)).toBeNull();
  });

  it('stores and retrieves an array of password reset requests', () => {
    const rows = [request('req-1')];

    setPasswordResetSnapshot(TEACHER, rows);

    expect(getPasswordResetSnapshot(TEACHER)).toEqual(rows);
  });

  it('distinguishes an intentionally empty snapshot from a missing one', () => {
    setPasswordResetSnapshot(TEACHER, []);

    expect(getPasswordResetSnapshot(TEACHER)).toEqual([]);
    expect(getPasswordResetSnapshot(OTHER_TEACHER)).toBeNull();
  });

  it('returns a shallow clone to prevent external mutation', () => {
    setPasswordResetSnapshot(TEACHER, [request('req-1')]);

    getPasswordResetSnapshot(TEACHER)?.push(request('req-2'));

    expect(getPasswordResetSnapshot(TEACHER)).toHaveLength(1);
  });

  it('stores a clone so a later caller mutation cannot reach the snapshot', () => {
    const rows = [request('req-1')];
    setPasswordResetSnapshot(TEACHER, rows);

    rows.push(request('req-2'));

    expect(getPasswordResetSnapshot(TEACHER)).toHaveLength(1);
  });

  it('never returns one account snapshot to another uid', () => {
    setPasswordResetSnapshot(TEACHER, [request('req-1')]);

    expect(getPasswordResetSnapshot(OTHER_TEACHER)).toBeNull();
  });

  it('never returns one account snapshot to another role of the same uid', () => {
    setPasswordResetSnapshot(TEACHER, [request('req-1')]);

    expect(getPasswordResetSnapshot(SAME_UID_OTHER_ROLE)).toBeNull();
  });

  it('keeps identities independent when both are stored', () => {
    setPasswordResetSnapshot(TEACHER, [request('req-1')]);
    setPasswordResetSnapshot(OTHER_TEACHER, [request('req-2'), request('req-3')]);

    expect(getPasswordResetSnapshot(TEACHER)).toHaveLength(1);
    expect(getPasswordResetSnapshot(OTHER_TEACHER)).toHaveLength(2);
  });

  it('clears every identity when requested', () => {
    setPasswordResetSnapshot(TEACHER, [request('req-1')]);
    setPasswordResetSnapshot(OTHER_TEACHER, [request('req-2')]);

    clearPasswordResetSnapshot();

    expect(getPasswordResetSnapshot(TEACHER)).toBeNull();
    expect(getPasswordResetSnapshot(OTHER_TEACHER)).toBeNull();
  });
});
