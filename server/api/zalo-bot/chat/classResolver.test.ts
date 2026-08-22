import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';
import { listAuthorizedClasses, resolveZaloBotClass } from './classResolver.js';
import type { UserContext } from '../../lib/auth/authz.js';

const teacherA: UserContext = { uid: 'teacher_a', role: 'teacher', name: 'A' };
const teacherB: UserContext = { uid: 'teacher_b', role: 'teacher', name: 'B' };
const officeUser: UserContext = { uid: 'office_1', role: 'office', name: 'O' };

describe('classResolver', () => {
  let db: any;
  let memory: ReturnType<typeof createInMemoryDocumentStore>;

  beforeEach(() => {
    memory = createInMemoryDocumentStore({
      'classes/c_a1': { name: '7A1', teacherId: 'teacher_a', status: 'active', grade: 7 },
      'classes/c_a2': { name: '7A2', teacherId: 'teacher_a', status: 'active', grade: 7 },
      'classes/c_a8': { name: '8B1', teacherId: 'teacher_a', status: 'active', grade: 8 },
      'classes/c_b1': { name: '9C1', teacherId: 'teacher_b', status: 'active', grade: 9 },
      'classes/c_old': { name: '6D1', teacherId: 'teacher_a', status: 'archived', grade: 6 },
    });
    db = memory.db;
  });

  describe('listAuthorizedClasses', () => {
    it('gives a teacher only the classes they teach', async () => {
      const rows = await listAuthorizedClasses(db, teacherA);
      expect(rows.map((row) => row.classId).sort()).toEqual(['c_a1', 'c_a2', 'c_a8']);
    });

    it('gives office every non-archived class', async () => {
      const rows = await listAuthorizedClasses(db, officeUser);
      expect(rows.map((row) => row.classId).sort()).toEqual(['c_a1', 'c_a2', 'c_a8', 'c_b1']);
    });

    it('queries by teacherId rather than scanning for a teacher', async () => {
      await listAuthorizedClasses(db, teacherA);
      expect(memory.queryLog).toContainEqual(
        expect.objectContaining({
          collection: 'classes',
          filters: expect.arrayContaining([['teacherId', '==', 'teacher_a']]),
        })
      );
    });
  });

  describe('resolveZaloBotClass', () => {
    it('resolves an exact class name', async () => {
      const result = await resolveZaloBotClass(db, teacherA, '7A1');
      expect(result).toEqual({ kind: 'found', classId: 'c_a1', className: '7A1' });
    });

    it('matches ignoring case, spaces, and Vietnamese diacritics', async () => {
      const result = await resolveZaloBotClass(db, teacherA, ' lớp 8b1 ');
      expect(result).toEqual({ kind: 'found', classId: 'c_a8', className: '8B1' });
    });

    it('normalizes Vietnamese đ as part of removing diacritics', async () => {
      const special = createInMemoryDocumentStore({
        'classes/d1': { name: 'Đề 1', teacherId: 'teacher_a', status: 'active' },
      });
      const result = await resolveZaloBotClass(special.db as any, teacherA, 'de 1');
      expect(result).toEqual({ kind: 'found', classId: 'd1', className: 'Đề 1' });
    });

    it('does not strip the first letter from an authorized class whose name starts with K', async () => {
      const special = createInMemoryDocumentStore({
        'classes/ket1': { name: 'KET 1', teacherId: 'teacher_a', status: 'active' },
      });

      const result = await resolveZaloBotClass(special.db as any, teacherA, 'KET 1');

      expect(result).toEqual({ kind: 'found', classId: 'ket1', className: 'KET 1' });
    });

    it('treats a bare grade as a grade filter and reports ambiguity', async () => {
      const result = await resolveZaloBotClass(db, teacherA, 'lớp 7');
      expect(result.kind).toBe('ambiguous');
      if (result.kind !== 'ambiguous') throw new Error('unreachable');
      expect(result.candidates.map((row) => row.className).sort()).toEqual(['7A1', '7A2']);
    });

    it('resolves a bare grade when the teacher has exactly one class in it', async () => {
      const result = await resolveZaloBotClass(db, teacherA, '8');
      expect(result).toEqual({ kind: 'found', classId: 'c_a8', className: '8B1' });
    });

    // Đây là test hồi quy cho yêu cầu cốt lõi.
    it('refuses another teacher class by exact name and never reads it', async () => {
      const result = await resolveZaloBotClass(db, teacherA, '9C1');
      expect(result).toEqual({ kind: 'not_found' });
      expect(memory.readLog).not.toContain('classes/c_b1');
    });

    it('refuses a grade that only exists in another teacher classes', async () => {
      const result = await resolveZaloBotClass(db, teacherA, 'lớp 9');
      expect(result).toEqual({ kind: 'not_found' });
    });

    it('hides archived classes from a teacher', async () => {
      const result = await resolveZaloBotClass(db, teacherA, '6D1');
      expect(result).toEqual({ kind: 'not_found' });
    });

    it('resolves a missing hint when the actor has exactly one class', async () => {
      const single = createInMemoryDocumentStore({
        'classes/only': { name: '7A1', teacherId: 'teacher_a', status: 'active', grade: 7 },
      });
      const result = await resolveZaloBotClass(single.db as any, teacherA, null);
      expect(result).toEqual({ kind: 'found', classId: 'only', className: '7A1' });
    });

    it('asks which class when the hint is missing and there are several', async () => {
      const result = await resolveZaloBotClass(db, teacherA, null);
      expect(result.kind).toBe('ambiguous');
    });

    it('returns not_found when the actor has no classes at all', async () => {
      const result = await resolveZaloBotClass(db, teacherB, '7A1');
      expect(result).toEqual({ kind: 'not_found' });
    });

    it('fails closed instead of silently truncating an oversized candidate set', async () => {
      const seed = Object.fromEntries(
        Array.from({ length: 501 }, (_, index) => [
          `classes/c_${index}`,
          { name: `Lớp ${index}`, teacherId: 'teacher_a', status: 'active' },
        ])
      );
      const oversized = createInMemoryDocumentStore(seed);
      await expect(resolveZaloBotClass(oversized.db as any, teacherA, 'Lớp 500')).rejects.toThrow(
        'authorized class set exceeds 500 rows'
      );
    });
  });
});
