import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Class } from '../../types';
import { readOfficeAcademicReferences } from '../api/frontendReadApi';
import { loadStudentEditReferenceData } from './studentActionReferenceData';

vi.mock('../api/frontendReadApi', () => ({ readOfficeAcademicReferences: vi.fn() }));

const currentClass = {
  id: 'class-1',
  name: 'Movers 2',
  teacherId: 'teacher-1',
  status: 'active',
} as Class;
const archivedClass = {
  id: 'class-2',
  name: 'Starters 1',
  teacherId: 'teacher-1',
  status: 'archived',
} as Class;

describe('loadStudentEditReferenceData', () => {
  beforeEach(() => vi.mocked(readOfficeAcademicReferences).mockReset());

  it('returns only the current class for a teacher without a global read', async () => {
    await expect(loadStudentEditReferenceData({ role: 'teacher', currentClass })).resolves.toEqual({
      classes: [currentClass],
      sortedClasses: [currentClass],
      filterableClasses: [currentClass],
      teachers: [],
    });
    expect(readOfficeAcademicReferences).not.toHaveBeenCalled();
  });

  it('loads and sorts visible classes and teachers for office', async () => {
    vi.mocked(readOfficeAcademicReferences).mockResolvedValue({
      classes: [currentClass, archivedClass],
      teachers: [{ uid: 'teacher-1', displayName: 'Cô Lan' }],
    } as any);

    const result = await loadStudentEditReferenceData({ role: 'office', currentClass });
    expect(readOfficeAcademicReferences).toHaveBeenCalledTimes(1);
    expect(result.classes.map((row) => row.id)).toContain(currentClass.id);
    expect(result.filterableClasses.every((row) => row.status !== 'archived')).toBe(true);
    expect(result.teachers).toEqual([{ uid: 'teacher-1', displayName: 'Cô Lan' }]);
  });
});
