import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../api/readApi';
import { readAssignmentsData, readClassDetailData } from '../api/frontendReadApi';
import {
  classAssignmentsQueryOptions,
  classDailyReportsQueryOptions,
  classEvaluationsQueryOptions,
  classMetadataQueryOptions,
  classRosterQueryOptions,
  classSubmissionsQueryOptions,
} from './classDetailQueries';

vi.mock('../api/readApi', () => ({ readChannel: vi.fn() }));
vi.mock('../api/frontendReadApi', () => ({
  readAssignmentsData: vi.fn(),
  readClassDetailData: vi.fn(),
}));

const identity = { uid: 'teacher-1', role: 'teacher' };

describe('class detail PostgreSQL queries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads metadata and roster from class-detail views', async () => {
    vi.mocked(readClassDetailData).mockResolvedValue({ class: { id: 'class-1' } } as any);
    vi.mocked(readChannel).mockResolvedValue({ students: [{ id: 'student-1' }] } as any);

    await expect(classMetadataQueryOptions(identity, 'class-1').queryFn!({} as any)).resolves.toEqual({
      id: 'class-1',
    });
    await expect(
      classRosterQueryOptions(identity, 'class-1', '2026-08-01').queryFn!({} as any)
    ).resolves.toEqual([{ id: 'student-1' }]);
    expect(readChannel).toHaveBeenCalledWith('class-detail', {
      view: 'roster',
      classId: 'class-1',
      attendanceTermStart: '2026-08-01',
    });
  });

  it('filters deleted and cross-class assessment rows', async () => {
    vi.mocked(readClassDetailData).mockResolvedValue({
      evaluations: [{ id: 'evaluation-1' }, { id: 'evaluation-2', isDeleted: true }],
      reports: [
        { id: 'report-own', teacherId: 'teacher-1' },
        { id: 'report-other', teacherId: 'teacher-2' },
      ],
    } as any);
    vi.mocked(readAssignmentsData).mockResolvedValue({
      assignments: [
        { id: 'assignment-1', classId: 'class-1' },
        { id: 'assignment-2', classId: 'class-2' },
        { id: 'assignment-3', classId: 'class-1', isDeleted: true },
      ],
      submissions: [
        { id: 'submission-1', classId: 'class-1' },
        { id: 'submission-2', classId: 'class-1', isDeleted: true },
      ],
    } as any);

    await expect(classEvaluationsQueryOptions(identity, 'class-1').queryFn!({} as any)).resolves.toEqual([
      { id: 'evaluation-1' },
    ]);
    await expect(classAssignmentsQueryOptions(identity, 'class-1').queryFn!({} as any)).resolves.toEqual([
      { id: 'assignment-1', classId: 'class-1' },
    ]);
    await expect(classSubmissionsQueryOptions(identity, 'class-1').queryFn!({} as any)).resolves.toEqual([
      { id: 'submission-1', classId: 'class-1' },
    ]);
    await expect(classDailyReportsQueryOptions(identity, 'class-1').queryFn!({} as any)).resolves.toEqual([
      { id: 'report-own', teacherId: 'teacher-1' },
    ]);
  });

  it('isolates query keys by reader identity', () => {
    expect(classMetadataQueryOptions(identity, 'class-1').queryKey).not.toEqual(
      classMetadataQueryOptions({ uid: 'admin-1', role: 'admin' }, 'class-1').queryKey
    );
  });
});
