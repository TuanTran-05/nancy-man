import { describe, expect, it } from 'vitest';
import { createInMemoryDocumentStore } from '../../../../../test-utils/inMemoryDocumentStore.js';
import {
  normalizeVietnameseSearchText,
  parseOrdinalFromText,
  resolveStudent,
} from './adminEntityResolver.js';

describe('adminEntityResolver', () => {
  it('normalizes Vietnamese search text removing diacritics and special characters', () => {
    expect(normalizeVietnameseSearchText('Nguyễn Thị Đào')).toBe('nguyen thi dao');
    expect(normalizeVietnameseSearchText('Lớp Movers - Ms. Lan')).toBe('lop movers ms lan');
  });

  it('parses ordinal from Vietnamese phrases', () => {
    expect(parseOrdinalFromText('em thứ hai')).toBe(2);
    expect(parseOrdinalFromText('bạn thứ 1')).toBe(1);
    expect(parseOrdinalFromText('em thứ ba đóng tiền chưa')).toBe(3);
    expect(parseOrdinalFromText('học sinh thứ tư')).toBe(4);
    expect(parseOrdinalFromText('chuyển tiền cho lớp')).toBeNull();
  });

  it('resolves ambiguous candidates when two students have the same name', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/s1': { name: 'Nguyễn Văn Minh', studentId: 'HV01', studentLifecycle: 'enrolled' },
      'students/s2': { name: 'Nguyễn Văn Minh', studentId: 'HV02', studentLifecycle: 'enrolled' },
      'student_course_enrollments/e1': {
        id: 'e1',
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-01-01',
        joinedAt: '2026-01-01',
      },
      'student_course_enrollments/e2': {
        id: 'e2',
        studentId: 's2',
        classId: 'c2',
        status: 'active',
        termStart: '2026-01-01',
        joinedAt: '2026-01-01',
      },
      'classes/c1': { name: 'Lớp 1A', teacherId: 't1' },
      'classes/c2': { name: 'Lớp 2A', teacherId: 't2' },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'users/t2': { name: 'Cô Mai', role: 'teacher' },
    });

    const result = await resolveStudent(db as any, { studentHint: 'Minh' });
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates.map((c) => c.code)).toEqual(['HV01', 'HV02']);
    }
  });

  it('resolves unique student when filtered by teacher hint', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/s1': { name: 'Nguyễn Văn Minh', studentId: 'HV01', studentLifecycle: 'enrolled' },
      'students/s2': { name: 'Nguyễn Văn Minh', studentId: 'HV02', studentLifecycle: 'enrolled' },
      'student_course_enrollments/e1': {
        id: 'e1',
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-01-01',
        joinedAt: '2026-01-01',
      },
      'student_course_enrollments/e2': {
        id: 'e2',
        studentId: 's2',
        classId: 'c2',
        status: 'active',
        termStart: '2026-01-01',
        joinedAt: '2026-01-01',
      },
      'classes/c1': { name: 'Flyers Advanced', teacherId: 't1' }, // Class name doesn't contain "Lan"
      'classes/c2': { name: 'Flyers Basic', teacherId: 't2' },
      'users/t1': { name: 'Cô Lan', role: 'teacher' },
      'users/t2': { name: 'Cô Mai', role: 'teacher' },
    });

    const result = await resolveStudent(db as any, {
      studentHint: 'Minh',
      teacherHint: 'Lan',
    });

    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.student.id).toBe('s1');
      expect(result.student.studentCode).toBe('HV01');
      expect(result.student.currentClassName).toBe('Flyers Advanced');
    }
  });

  it('resolves ordinal follow-up from active session pending candidates', async () => {
    const { db } = createInMemoryDocumentStore({
      'students/s1': { name: 'Nguyễn Văn Minh', studentId: 'HV01', studentLifecycle: 'enrolled' },
      'students/s2': { name: 'Nguyễn Hoàng Minh', studentId: 'HV02', studentLifecycle: 'enrolled' },
      'student_course_enrollments/e1': {
        id: 'e1',
        studentId: 's1',
        classId: 'c1',
        status: 'active',
        termStart: '2026-01-01',
        joinedAt: '2026-01-01',
      },
      'student_course_enrollments/e2': {
        id: 'e2',
        studentId: 's2',
        classId: 'c2',
        status: 'active',
        termStart: '2026-01-01',
        joinedAt: '2026-01-01',
      },
      'classes/c1': { name: 'Lớp 1A', teacherId: 't1' },
      'classes/c2': { name: 'Lớp 2A', teacherId: 't2' },
    });

    const session = {
      staffId: 'admin_1',
      pendingCandidateIds: ['s1', 's2'],
      updatedAt: '2026-08-16T10:00:00Z',
      expiresAt: '2026-08-16T10:15:00Z',
    };

    const result = await resolveStudent(db as any, {
      rawQuestionText: 'Em thứ 2 đóng tiền chưa?',
      session,
    });

    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.student.id).toBe('s2');
      expect(result.student.fullName).toBe('Nguyễn Hoàng Minh');
    }
  });

  it('returns not_found when ordinal is out of range', async () => {
    const { db } = createInMemoryDocumentStore({});

    const session = {
      staffId: 'admin_1',
      pendingCandidateIds: ['s1'],
      updatedAt: '2026-08-16T10:00:00Z',
      expiresAt: '2026-08-16T10:15:00Z',
    };

    const result = await resolveStudent(db as any, {
      rawQuestionText: 'Em thứ 5 đóng tiền chưa?',
      session,
    });

    expect(result.status).toBe('not_found');
  });
});
