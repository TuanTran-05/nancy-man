import { describe, expect, it, vi } from 'vitest';
import {
  applyStudentLinkedUsersInTransaction,
  buildLinkedStudentUserPatch,
  readStudentLinkedUsersInTransaction,
  syncStudentLinkedUsersInTransaction,
} from './studentProfileSync.js';

function makeDocRef(id: string) {
  return { id, path: `users/${id}` };
}

function makeSnap(exists: boolean) {
  return { exists };
}

describe('student linked user profile sync', () => {
  it('builds a student user patch from canonical student fields', () => {
    const patch = buildLinkedStudentUserPatch('student', 'stu-1', {
      name: 'Nguyen Van A',
      classId: 'class-2',
      teacherId: 'teacher-2',
      enrollmentStatus: 'on_leave',
      isRevoked: false,
      faceImage: 'https://example.com/a.png',
      faceImageStoragePath: 'faces/stu-1.png',
      forcePasswordChange: true,
    });

    expect(patch).toMatchObject({
      studentId: 'stu-1',
      displayName: 'Nguyen Van A',
      classId: 'class-2',
      teacherId: 'teacher-2',
      enrollmentStatus: 'on_leave',
      isRevoked: false,
      faceImage: 'https://example.com/a.png',
      faceImageStoragePath: 'faces/stu-1.png',
      forcePasswordChange: true,
    });
    expect(patch.updatedAt).toBeDefined();
  });

  it('does not overwrite parent displayName while syncing parent auth state', () => {
    const patch = buildLinkedStudentUserPatch('parent', 'stu-1', {
      name: 'Nguyen Van A',
      classId: 'class-2',
      teacherId: 'teacher-2',
      enrollmentStatus: 'active',
      isRevoked: false,
      parentForcePasswordChange: true,
    });

    expect(patch).toMatchObject({
      studentId: 'stu-1',
      classId: 'class-2',
      teacherId: 'teacher-2',
      enrollmentStatus: 'active',
      isRevoked: false,
      forcePasswordChange: true,
    });
    expect(patch).not.toHaveProperty('displayName');
    expect(patch).not.toHaveProperty('faceImage');
    expect(patch).not.toHaveProperty('faceImageStoragePath');
  });

  it('updates only existing deterministic student and parent user documents', async () => {
    const studentUserRef = makeDocRef('student:stu-1');
    const parentUserRef = makeDocRef('parent:stu-1');
    const userDoc = vi.fn((id: string) => {
      if (id === 'student:stu-1') return studentUserRef;
      if (id === 'parent:stu-1') return parentUserRef;
      throw new Error(`Unexpected user doc ${id}`);
    });
    const db = {
      collection: vi.fn((name: string) => {
        expect(name).toBe('users');
        return { doc: userDoc };
      }),
    } as any;
    const tx = {
      get: vi.fn(async (ref: unknown) =>
        ref === studentUserRef ? makeSnap(true) : makeSnap(false)
      ),
      update: vi.fn(),
    } as any;

    await syncStudentLinkedUsersInTransaction(tx, db, 'stu-1', {
      name: 'Nguyen Van A',
      classId: 'class-2',
      teacherId: 'teacher-2',
      enrollmentStatus: 'dropped',
      isRevoked: true,
    });

    expect(tx.get).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledWith(
      studentUserRef,
      expect.objectContaining({
        studentId: 'stu-1',
        classId: 'class-2',
        teacherId: 'teacher-2',
        enrollmentStatus: 'dropped',
        isRevoked: true,
        displayName: 'Nguyen Van A',
      })
    );
    expect(tx.update).not.toHaveBeenCalledWith(parentUserRef, expect.anything());
  });

  it('preloads linked users before writes and applies patches without additional reads', async () => {
    const studentUserRef = makeDocRef('student:stu-1');
    const parentUserRef = makeDocRef('parent:stu-1');
    const unrelatedRef = {
      id: 'enrollment-1',
      path: 'student_course_enrollments/enrollment-1',
    };
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn((id: string) => (id === 'student:stu-1' ? studentUserRef : parentUserRef)),
      })),
    } as any;
    const tx = {
      get: vi.fn(async (ref: unknown) => makeSnap(ref === studentUserRef)),
      update: vi.fn(),
    } as any;

    const preload = await readStudentLinkedUsersInTransaction(tx, db, 'stu-1');
    tx.update(unrelatedRef, { status: 'dropped' });
    applyStudentLinkedUsersInTransaction(
      tx,
      'stu-1',
      { name: 'Nguyen Van A', enrollmentStatus: 'dropped', isRevoked: true },
      preload
    );

    expect(tx.get).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenLastCalledWith(
      studentUserRef,
      expect.objectContaining({
        studentId: 'stu-1',
        displayName: 'Nguyen Van A',
        enrollmentStatus: 'dropped',
        isRevoked: true,
      })
    );
  });
});
