// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocs, onSnapshot } from '@/src/test/legacyDataTestApi';
import { readAllStudentPages, readChannel } from '../api/readApi';
import { useStudentDirectoryData } from './useStudentDirectoryData';
import { useInvalidationRefresh } from '../../hooks/useInvalidationRefresh';
import { STUDENT_DIRECTORY_PAGE_SIZE } from '../api/readLimits';
import { studentDirectoryQueryKeys } from './studentDirectoryQueries';
import type { Class, CourseFeeLedger, SafeStudent, Submission, UserProfile } from '../../types';

vi.mock('../api/readApi', () => ({
  readAllStudentPages: vi.fn(),
  readChannel: vi.fn(),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'teacher-1', displayName: 'Teacher One' } },
  db: {},
}));

vi.mock('@/src/test/legacyDataTestApi', () => ({
  collection: vi.fn((_db, name: string) => ({ kind: 'collection', name })),
  query: vi.fn((...parts: unknown[]) => ({ kind: 'query', parts })),
  where: vi.fn((...args: unknown[]) => ({ kind: 'where', args })),
  limit: vi.fn((count: number) => ({ kind: 'limit', count })),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('../../hooks/useInvalidationRefresh', () => ({
  useInvalidationRefresh: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createQueryHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function student(id: string, extra: Partial<SafeStudent> = {}): SafeStudent {
  return {
    id,
    name: `Student ${id}`,
    studentId: id.toUpperCase(),
    dob: '2012-08-06',
    contact: '0345647924',
    classId: 'class-1',
    teacherId: 'teacher-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    code: id,
    ...extra,
  };
}

function classRow(id: string, extra: Partial<Class> = {}): Class {
  return {
    id,
    name: `Class ${id}`,
    schedule: '',
    daysOfWeek: [],
    description: '',
    startDate: '2026-01-01',
    endDate: '',
    startTime: '18:00',
    teacherId: 'teacher-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function ledger(id: string, extra: Partial<CourseFeeLedger> = {}): CourseFeeLedger {
  return {
    id,
    studentId: 'student-1',
    classId: 'class-1',
    amount: 1000,
    paidTotal: 0,
    status: 'unpaid',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function submission(id: string, extra: Partial<Submission> = {}): Submission {
  return {
    id,
    assignmentId: 'assignment-1',
    studentId: 'student-1',
    teacherId: 'teacher-1',
    classId: 'class-1',
    content: '',
    status: 'graded',
    grade: 9,
    submittedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function docsFor<T extends Record<string, unknown>>(rows: Array<{ id: string; data: T }>) {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function accountingPayload(overrides: Record<string, unknown> = {}) {
  return {
    students: [student('student-1')],
    classes: [classRow('class-1')],
    teachers: [{ uid: 'teacher-1', displayName: 'Teacher One' }],
    ledgers: [ledger('ledger-1')],
    page: { nextCursor: 'cursor-1', hasMore: true },
    ...overrides,
  };
}

describe('useStudentDirectoryData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDocs).mockResolvedValue(docsFor([]) as any);
    vi.mocked(onSnapshot).mockImplementation(((_query: unknown, onNext: (snap: any) => void) => {
      onNext(docsFor([]));
      return vi.fn();
    }) as any);
  });

  it('loads accounting first page with limit, classId, server mode, and all collections', async () => {
    vi.mocked(readChannel).mockResolvedValue(accountingPayload() as any);
    const { wrapper } = createQueryHarness();

    const { result } = renderHook(
      () => useStudentDirectoryData({ role: 'accounting', classId: 'class-1' }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(readChannel).toHaveBeenCalledWith('accounting-students', {
      limit: 100,
      classId: 'class-1',
    });
    expect(result.current.paginationMode).toBe('server');
    expect(result.current.students).toHaveLength(1);
    expect(result.current.classes).toHaveLength(1);
    expect(result.current.teachers).toHaveLength(1);
    expect(result.current.ledgers).toHaveLength(1);
    expect(result.current.hasMoreServer).toBe(true);
    expect(result.current.parentProfiles).toEqual([]);
    expect(result.current.parentProfilesLoaded).toBe(false);
    expect(result.current.gradedSubmissions).toEqual([]);
  });

  it('never exposes the previous account local rows during a same-role uid switch', async () => {
    const nextAccount = deferred<ReturnType<typeof accountingPayload>>();
    vi.mocked(readChannel)
      .mockResolvedValueOnce(
        accountingPayload({ students: [student('old-account-student')] }) as any
      )
      .mockReturnValueOnce(nextAccount.promise as any);
    const seenRenders: Array<{ uid: string; studentIds: string[]; classIds: string[] }> = [];
    const { wrapper } = createQueryHarness();

    const hook = renderHook(
      ({ uid }) => {
        const data = useStudentDirectoryData({ uid, role: 'accounting' });
        seenRenders.push({
          uid,
          studentIds: data.students.map((row) => row.id),
          classIds: data.classes.map((row) => row.id),
        });
        return data;
      },
      { initialProps: { uid: 'accounting-1' }, wrapper }
    );
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.students.map((row) => row.id)).toEqual(['old-account-student']);

    seenRenders.length = 0;
    hook.rerender({ uid: 'accounting-2' });

    expect(
      seenRenders.some(
        (render) =>
          render.uid === 'accounting-2' &&
          (render.studentIds.includes('old-account-student') || render.classIds.includes('class-1'))
      )
    ).toBe(false);

    await act(async () => {
      nextAccount.resolve(
        accountingPayload({
          students: [student('new-account-student')],
          classes: [classRow('class-2')],
        })
      );
      await nextAccount.promise;
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.students.map((row) => row.id)).toEqual(['new-account-student']);
  });

  it('loads more accounting rows with cursor and lets newer duplicate records win', async () => {
    vi.mocked(readChannel)
      .mockResolvedValueOnce(accountingPayload() as any)
      .mockResolvedValueOnce(
        accountingPayload({
          students: [student('student-1', { name: 'Updated Student' }), student('student-2')],
          ledgers: [
            ledger('ledger-1', { status: 'partial' }),
            ledger('ledger-2', { studentId: 'student-2' }),
          ],
          page: { nextCursor: null, hasMore: false },
        }) as any
      );

    const { wrapper } = createQueryHarness();
    const { result } = renderHook(() => useStudentDirectoryData({ role: 'accounting' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMoreServer();
    });

    expect(readChannel).toHaveBeenLastCalledWith('accounting-students', {
      limit: 100,
      cursor: 'cursor-1',
    });
    expect(result.current.students.map((s) => `${s.id}:${s.name}`)).toEqual([
      'student-2:Student student-2',
      'student-1:Updated Student',
    ]);
    expect(result.current.ledgers.map((l) => `${l.id}:${l.status}`)).toEqual([
      'ledger-1:partial',
      'ledger-2:unpaid',
    ]);
    expect(result.current.hasMoreServer).toBe(false);
  });

  it('replaces accounting data on class change and ignores stale first-page responses', async () => {
    const classOne = deferred<unknown>();
    const classTwo = deferred<unknown>();
    vi.mocked(readChannel)
      .mockReturnValueOnce(classOne.promise as any)
      .mockReturnValueOnce(classTwo.promise as any);

    const { wrapper } = createQueryHarness();
    const { result, rerender } = renderHook(
      ({ classId }) => useStudentDirectoryData({ role: 'accounting', classId }),
      { initialProps: { classId: 'class-1' }, wrapper }
    );
    rerender({ classId: 'class-2' });

    await act(async () => {
      classTwo.resolve(
        accountingPayload({
          students: [student('student-2', { classId: 'class-2' })],
          ledgers: [ledger('ledger-2', { studentId: 'student-2', classId: 'class-2' })],
          page: { nextCursor: null, hasMore: false },
        })
      );
      await classTwo.promise;
    });

    await waitFor(() => expect(result.current.students[0]?.id).toBe('student-2'));

    await act(async () => {
      classOne.resolve(accountingPayload({ students: [student('student-1')] }));
      await classOne.promise;
    });

    expect(result.current.students.map((s) => s.id)).toEqual(['student-2']);
    expect(readChannel).toHaveBeenNthCalledWith(1, 'accounting-students', {
      limit: 100,
      classId: 'class-1',
    });
    expect(readChannel).toHaveBeenNthCalledWith(2, 'accounting-students', {
      limit: 100,
      classId: 'class-2',
    });
  });

  it('uses client mode for admin and loads students, parents, ledgers, and graded submissions', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'accounting-students') return { ledgers: [ledger('ledger-1')] } as any;
      if (channel === 'assignments') {
        return {
          submissions: [submission('graded-1'), submission('submitted-1', { status: 'submitted' })],
        } as any;
      }
      if (channel === 'classes') return { classes: [classRow('class-1')] } as any;
      if (channel === 'student-directory-references') {
        return {
          teachers: [{ uid: 'teacher-1', displayName: 'Teacher One' }],
          parentProfiles: [
            {
              uid: 'parent-1',
              role: 'parent',
              studentId: 'student-1',
              updatedAt: '2026-07-18T01:02:03.000Z',
            } satisfies UserProfile,
          ],
        } as any;
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    const { wrapper } = createQueryHarness();
    const { result } = renderHook(() => useStudentDirectoryData({ role: 'admin' }), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paginationMode).toBe('client');
    expect(result.current.students).toHaveLength(1);
    expect(result.current.parentProfiles).toHaveLength(1);
    expect(result.current.parentProfilesLoaded).toBe(true);
    expect(result.current.ledgers).toHaveLength(1);
    expect(result.current.gradedSubmissions.map((s) => s.id)).toEqual(['graded-1']);
    expect(readChannel).toHaveBeenCalledWith(
      'accounting-students',
      expect.objectContaining({ view: 'ledgers' })
    );
    expect(readChannel).toHaveBeenCalledWith(
      'assignments',
      expect.objectContaining({ view: 'graded-submissions' })
    );
  });

  it('uses small roster pages so the first batch can paint quickly', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(onSnapshot).mockImplementation(((_query: unknown, onNext: (snap: any) => void) => {
      onNext(docsFor([{ id: 'class-1', data: classRow('class-1') as any }]));
      return vi.fn();
    }) as any);

    const { wrapper } = createQueryHarness();
    const { result } = renderHook(() => useStudentDirectoryData({ role: 'office' }), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(readAllStudentPages).toHaveBeenCalledWith(
      {
        view: 'directory',
        limit: STUDENT_DIRECTORY_PAGE_SIZE,
      },
      { onPage: expect.any(Function) }
    );
    expect(STUDENT_DIRECTORY_PAGE_SIZE).toBeLessThanOrEqual(200);
  });

  it('publishes the first roster page while later pages are still loading', async () => {
    const finalRoster = deferred<SafeStudent[]>();
    vi.mocked(readAllStudentPages).mockImplementationOnce((async (
      _params: unknown,
      options: any
    ) => {
      options?.onPage?.({
        students: [student('student-1')],
        pageNumber: 1,
        hasMore: true,
      });
      return finalRoster.promise;
    }) as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'accounting-students') return { ledgers: [] } as any;
      if (channel === 'assignments') return { submissions: [] } as any;
      if (channel === 'student-directory-references')
        return { teachers: [], parentProfiles: [] } as any;
      if (channel === 'classes') return { classes: [] } as any;
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { wrapper } = createQueryHarness();
    const { result } = renderHook(
      () => useStudentDirectoryData({ uid: 'admin-1', role: 'admin' }),
      {
        wrapper,
      }
    );

    await waitFor(() =>
      expect(result.current.students.map((row) => row.id)).toEqual(['student-1'])
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.loadingRemainingStudents).toBe(true);

    await act(async () => {
      finalRoster.resolve([student('student-1'), student('student-2')]);
      await finalRoster.promise;
    });
    await waitFor(() => expect(result.current.loadingRemainingStudents).toBe(false));
    expect(result.current.students.map((row) => row.id)).toEqual(['student-1', 'student-2']);
  });

  it('keeps office parent profiles unloaded and does not create a parent query', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(onSnapshot).mockImplementation(((_query: unknown, onNext: (snap: any) => void) => {
      onNext(docsFor([{ id: 'class-1', data: classRow('class-1') as any }]));
      return vi.fn();
    }) as any);

    const { wrapper } = createQueryHarness();
    const { result } = renderHook(() => useStudentDirectoryData({ role: 'office' }), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paginationMode).toBe('client');
    expect(onSnapshot).toHaveBeenCalledTimes(0);
    expect(result.current.parentProfiles).toEqual([]);
    expect(result.current.parentProfilesLoaded).toBe(false);
  });

  it('reuses fresh admin bulk data when the directory remounts', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'accounting-students') return { ledgers: [ledger('ledger-1')] } as any;
      if (channel === 'assignments') return { submissions: [submission('graded-1')] } as any;
      if (channel === 'classes') return { classes: [classRow('class-1')] } as any;
      if (channel === 'student-directory-references') {
        return { teachers: [], parentProfiles: [] } as any;
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { queryClient, wrapper } = createQueryHarness();

    const first = renderHook(() => useStudentDirectoryData({ role: 'admin' }), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useStudentDirectoryData({ role: 'admin' }), { wrapper });
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(readAllStudentPages).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(readChannel).mock.calls.filter(([channel]) => channel === 'accounting-students')
    ).toHaveLength(1);
    expect(
      vi.mocked(readChannel).mock.calls.filter(([channel]) => channel === 'assignments')
    ).toHaveLength(1);
    expect(
      vi.mocked(readChannel).mock.calls.filter(([channel]) => channel === 'classes')
    ).toHaveLength(2);
    second.unmount();
    queryClient.clear();
  });

  it('stores every admin dataset under uid-and-role-scoped cache keys', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'accounting-students') return { ledgers: [] } as any;
      if (channel === 'assignments') return { submissions: [] } as any;
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { queryClient, wrapper } = createQueryHarness();

    const hook = renderHook(() => useStudentDirectoryData({ role: 'admin' }), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(queryClient.getQueryData(['student-directory', 'teacher-1', 'admin', 'roster'])).toEqual(
      [student('student-1')]
    );
    expect(
      queryClient.getQueryData(['student-directory', 'teacher-1', 'admin', 'ledgers'])
    ).toEqual([]);
    expect(
      queryClient.getQueryData(['student-directory', 'teacher-1', 'admin', 'graded-submissions'])
    ).toEqual([]);
  });

  it('manually refreshes every enabled admin dataset once', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'accounting-students') return { ledgers: [ledger('ledger-1')] } as any;
      if (channel === 'assignments') return { submissions: [submission('graded-1')] } as any;
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { wrapper } = createQueryHarness();

    const hook = renderHook(() => useStudentDirectoryData({ uid: 'admin-1', role: 'admin' }), {
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    vi.mocked(readAllStudentPages).mockClear();
    vi.mocked(readChannel).mockClear();
    await act(async () => {
      await hook.result.current.refresh();
    });

    expect(readAllStudentPages).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(readChannel).mock.calls.filter(([channel]) => channel === 'accounting-students')
    ).toHaveLength(1);
    expect(
      vi.mocked(readChannel).mock.calls.filter(([channel]) => channel === 'assignments')
    ).toHaveLength(1);
  });

  it.each([
    {
      channelKey: 'students',
      expectedRosterReads: 1,
      expectedLedgerReads: 0,
      expectedSubmissionReads: 0,
    },
    {
      channelKey: 'finance-ledger',
      expectedRosterReads: 0,
      expectedLedgerReads: 1,
      expectedSubmissionReads: 0,
    },
    {
      channelKey: 'submissions',
      expectedRosterReads: 0,
      expectedLedgerReads: 0,
      expectedSubmissionReads: 1,
    },
  ])(
    'refetches only the matching admin dataset for $channelKey invalidation',
    async ({ channelKey, expectedRosterReads, expectedLedgerReads, expectedSubmissionReads }) => {
      vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
      vi.mocked(readChannel).mockImplementation(async (channel) => {
        if (channel === 'accounting-students') return { ledgers: [ledger('ledger-1')] } as any;
        if (channel === 'assignments') return { submissions: [submission('graded-1')] } as any;
        throw new Error(`Unexpected channel: ${channel}`);
      });
      const { wrapper } = createQueryHarness();

      const hook = renderHook(() => useStudentDirectoryData({ role: 'admin' }), { wrapper });
      await waitFor(() => expect(hook.result.current.loading).toBe(false));

      const registration = vi
        .mocked(useInvalidationRefresh)
        .mock.calls.map(([options]) => options)
        .find((options) => options.channelKey === channelKey);
      expect(registration).toBeDefined();

      vi.mocked(readAllStudentPages).mockClear();
      vi.mocked(readChannel).mockClear();
      await act(async () => {
        await registration!.onInvalidate();
      });

      expect(readAllStudentPages).toHaveBeenCalledTimes(expectedRosterReads);
      expect(
        vi.mocked(readChannel).mock.calls.filter(([channel]) => channel === 'accounting-students')
      ).toHaveLength(expectedLedgerReads);
      expect(
        vi.mocked(readChannel).mock.calls.filter(([channel]) => channel === 'assignments')
      ).toHaveLength(expectedSubmissionReads);
    }
  );

  it('rebinds teacher-scoped HTTP queries when the uid changes without a role change', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'assignments') return { submissions: [] } as any;
      if (channel === 'classes') return { classes: [classRow('class-1')] } as any;
      if (channel === 'student-directory-references') return { parentProfiles: [] } as any;
      return {} as any;
    });
    const { wrapper } = createQueryHarness();

    const hook = renderHook(({ uid }) => useStudentDirectoryData({ uid, role: 'teacher' }), {
      initialProps: { uid: 'teacher-1' },
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(
      vi
        .mocked(readChannel)
        .mock.calls.filter(([channel]) => channel === 'student-directory-references')
    ).toHaveLength(1);

    hook.rerender({ uid: 'teacher-2' });
    await waitFor(() => expect(readAllStudentPages).toHaveBeenCalledTimes(2));

    expect(
      vi
        .mocked(readChannel)
        .mock.calls.filter(([channel]) => channel === 'student-directory-references')
    ).toHaveLength(2);
  });

  it('does not run disabled bulk queries when refresh is called without an identity', async () => {
    const { wrapper } = createQueryHarness();
    const hook = renderHook(() => useStudentDirectoryData({ uid: '', role: undefined }), {
      wrapper,
    });

    await act(async () => {
      await hook.result.current.refresh();
    });

    expect(readAllStudentPages).not.toHaveBeenCalled();
    expect(readChannel).not.toHaveBeenCalled();
  });

  it('does not surface a cached error from a dataset disabled for the current role', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    const { queryClient, wrapper } = createQueryHarness();
    const hook = renderHook(() => useStudentDirectoryData({ uid: 'office-1', role: 'office' }), {
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    const disabledLedgerQuery = queryClient.getQueryCache().find({
      queryKey: studentDirectoryQueryKeys.ledgers({ uid: 'office-1', role: 'office' }),
      exact: true,
    });
    expect(disabledLedgerQuery).toBeDefined();

    act(() => {
      disabledLedgerQuery!.setState({
        ...disabledLedgerQuery!.state,
        status: 'error',
        error: new Error('disabled ledger failed'),
      });
    });

    expect(hook.result.current.error).toBeNull();
  });

  async function enabledInvalidationChannels(
    profile: Parameters<typeof useStudentDirectoryData>[0]
  ) {
    const { wrapper } = createQueryHarness();
    const hook = renderHook(() => useStudentDirectoryData(profile), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    const enabled = new Set(
      vi
        .mocked(useInvalidationRefresh)
        .mock.calls.map(([options]) => options)
        .filter((options) => options.enabled)
        .map((options) => options.channelKey)
    );
    return [...enabled].sort();
  }

  it('leaves office directory invalidation to the office bridge', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);

    expect(await enabledInvalidationChannels({ uid: 'office-1', role: 'office' })).toEqual([]);
  });

  it('leaves admin directory invalidation to the office bridge', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'accounting-students') return { ledgers: [ledger('ledger-1')] } as any;
      if (channel === 'assignments') return { submissions: [submission('graded-1')] } as any;
      throw new Error(`Unexpected channel: ${channel}`);
    });

    expect(await enabledInvalidationChannels({ uid: 'admin-1', role: 'admin' })).toEqual([]);
  });

  it('keeps the teacher directory transports page-local', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([student('student-1')] as any);
    vi.mocked(readChannel).mockImplementation(async (channel) => {
      if (channel === 'assignments') return { submissions: [submission('graded-1')] } as any;
      throw new Error(`Unexpected channel: ${channel}`);
    });

    expect(await enabledInvalidationChannels({ uid: 'teacher-1', role: 'teacher' })).toEqual([
      'students',
      'submissions',
    ]);
  });

  it('keeps the accounting directory transport page-local', async () => {
    vi.mocked(readChannel).mockResolvedValue(accountingPayload() as any);

    expect(await enabledInvalidationChannels({ uid: 'accounting-1', role: 'accounting' })).toEqual([
      'accounting-students',
    ]);
  });
});
