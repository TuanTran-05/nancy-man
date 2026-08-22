// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAllStudentPages } from '../lib/api/readApi';
import { useSafeStudents } from './useSafeStudents';

vi.mock('../lib/api/readApi', () => ({
  readAllStudentPages: vi.fn(),
}));

describe('useSafeStudents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads students through the read API with the selected projection and params', async () => {
    vi.mocked(readAllStudentPages).mockResolvedValue([
      { id: 'stu-1', name: 'Safe Student' } as any,
    ]);

    const { result } = renderHook(() => useSafeStudents('academic', { classId: 'class-1' }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(readAllStudentPages).toHaveBeenCalledWith({ view: 'academic', classId: 'class-1' });
    expect(result.current.students).toEqual([{ id: 'stu-1', name: 'Safe Student' }]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces API errors without falling back to DocumentStore', async () => {
    vi.mocked(readAllStudentPages).mockRejectedValue(new Error('denied'));

    const { result } = renderHook(() => useSafeStudents('directory'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(readAllStudentPages).toHaveBeenCalledWith({ view: 'directory' });
    expect(result.current.students).toEqual([]);
    expect(result.current.error?.message).toBe('denied');
  });
});
