import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readCalendarReferences,
  readClassesData,
  readOfficeTeacherReferences,
} from '../api/frontendReadApi';
import { getStudentDirectory } from '../api/studentDirectoryApi';
import {
  officeClassListQueryOptions,
  officeHolidaysQueryOptions,
  officeStudentIndexQueryOptions,
  officeTeacherReferencesQueryOptions,
} from './officeReferenceQueries';

vi.mock('../api/frontendReadApi', () => ({
  readCalendarReferences: vi.fn(),
  readClassesData: vi.fn(),
  readOfficeTeacherReferences: vi.fn(),
}));
vi.mock('../api/studentDirectoryApi', () => ({ getStudentDirectory: vi.fn() }));

const identity = { uid: 'office-1', role: 'office' };

describe('office reference queries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads classes, teachers, holidays and students through HTTP APIs', async () => {
    vi.mocked(readClassesData).mockResolvedValue({ classes: [{ id: 'class-1' }] } as any);
    vi.mocked(readOfficeTeacherReferences).mockResolvedValue({
      teachers: [{ uid: 'teacher-1', displayName: '', email: 'teacher@example.com' }],
    } as any);
    vi.mocked(readCalendarReferences).mockResolvedValue({
      systemHolidays: ['2026-01-01'],
    } as any);
    vi.mocked(getStudentDirectory).mockResolvedValue({ students: [{ id: 'student-1' }] } as any);

    await expect(officeClassListQueryOptions(identity).queryFn!({} as any)).resolves.toEqual([
      { id: 'class-1' },
    ]);
    await expect(
      officeTeacherReferencesQueryOptions(identity).queryFn!({} as any)
    ).resolves.toEqual([
      {
        uid: 'teacher-1',
        displayName: 'teacher@example.com',
        email: 'teacher@example.com',
        phone: '',
        blockedTeacher: false,
      },
    ]);
    await expect(officeHolidaysQueryOptions(identity).queryFn!({} as any)).resolves.toEqual([
      '2026-01-01',
    ]);
    await expect(officeStudentIndexQueryOptions(identity).queryFn!({} as any)).resolves.toEqual([
      { id: 'student-1' },
    ]);
    expect(getStudentDirectory).toHaveBeenCalledWith({ revalidate: true });
  });

  it('isolates cache keys by identity', () => {
    expect(officeClassListQueryOptions(identity).queryKey).not.toEqual(
      officeClassListQueryOptions({ uid: 'admin-1', role: 'admin' }).queryKey
    );
  });
});
