// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAssignmentAttemptDraft,
  getAssignmentAttemptDraft,
  saveAssignmentAttemptDraft,
} from '../../../lib/api/assignmentAttemptDraftApi';
import { useAssignmentAttemptAutosave } from './useAssignmentAttemptAutosave';

vi.mock('../../../lib/api/assignmentAttemptDraftApi', () => ({
  clearAssignmentAttemptDraft: vi.fn(),
  getAssignmentAttemptDraft: vi.fn(),
  saveAssignmentAttemptDraft: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(getAssignmentAttemptDraft).mockResolvedValue(null);
  vi.mocked(saveAssignmentAttemptDraft).mockResolvedValue({ id: 'draft-1' } as any);
  vi.mocked(clearAssignmentAttemptDraft).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAssignmentAttemptAutosave', () => {
  it('hydrates a newer local draft and debounces server saves', async () => {
    localStorage.setItem(
      'assignment-attempt-draft:assignment-1:student-1',
      JSON.stringify({
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        content: 'Recovered',
        quizAnswers: [],
        assessmentAnswers: [],
        updatedAt: '2026-06-12T02:00:00.000Z',
      })
    );
    const onHydrate = vi.fn();
    const quizAnswers = [];
    const assessmentAnswers = [];

    renderHook(() =>
      useAssignmentAttemptAutosave({
        enabled: true,
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        content: 'Recovered',
        quizAnswers,
        assessmentAnswers,
        onHydrate,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(onHydrate).toHaveBeenCalledWith(expect.objectContaining({ content: 'Recovered' }));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(saveAssignmentAttemptDraft).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: 'assignment-1', content: 'Recovered' })
    );
  });

  it('clears local and server draft on clearDraft', async () => {
    const quizAnswers = [];
    const assessmentAnswers = [];
    const { result } = renderHook(() =>
      useAssignmentAttemptAutosave({
        enabled: true,
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        content: 'Draft',
        quizAnswers,
        assessmentAnswers,
        onHydrate: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.clearDraft();
    });

    expect(clearAssignmentAttemptDraft).toHaveBeenCalledWith('assignment-1');
    expect(localStorage.getItem('assignment-attempt-draft:assignment-1:student-1')).toBeNull();
  });

  it('hydrates again when the same assignment is reopened after closing', async () => {
    vi.mocked(getAssignmentAttemptDraft)
      .mockResolvedValueOnce({
        id: 'draft-1',
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        studentName: 'Student',
        classId: 'class-1',
        teacherId: 'teacher-1',
        ownerUid: 'user-1',
        content: 'First open',
        quizAnswers: [],
        assessmentAnswers: [],
        attemptNumber: 1,
        status: 'in_progress',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T01:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'draft-1',
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        studentName: 'Student',
        classId: 'class-1',
        teacherId: 'teacher-1',
        ownerUid: 'user-1',
        content: 'Second open',
        quizAnswers: [],
        assessmentAnswers: [],
        attemptNumber: 1,
        status: 'in_progress',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T02:00:00.000Z',
      });
    const onHydrate = vi.fn();
    const quizAnswers = [];
    const assessmentAnswers = [];

    const { rerender } = renderHook(
      ({ enabled, content }) =>
        useAssignmentAttemptAutosave({
          enabled,
          assignmentId: 'assignment-1',
          studentId: 'student-1',
          content,
          quizAnswers,
          assessmentAnswers,
          onHydrate,
        }),
      { initialProps: { enabled: true, content: '' } }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(onHydrate).toHaveBeenCalledWith(expect.objectContaining({ content: 'First open' }));

    rerender({ enabled: false, content: '' });
    rerender({ enabled: true, content: '' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getAssignmentAttemptDraft).toHaveBeenCalledTimes(2);
    expect(onHydrate).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'Second open' }));
  });

  it('does not recreate an empty draft after clearing a recovered draft', async () => {
    const onHydrate = vi.fn();
    const quizAnswers = [];
    const assessmentAnswers = [];
    const { result, rerender } = renderHook(
      ({ content, quizAnswersValue, assessmentAnswersValue }) =>
        useAssignmentAttemptAutosave({
          enabled: true,
          assignmentId: 'assignment-1',
          studentId: 'student-1',
          content,
          quizAnswers: quizAnswersValue,
          assessmentAnswers: assessmentAnswersValue,
          onHydrate,
        }),
      {
        initialProps: {
          content: 'Recovered draft',
          quizAnswersValue: quizAnswers,
          assessmentAnswersValue: assessmentAnswers,
        },
      }
    );

    await act(async () => {
      await result.current.clearDraft();
    });
    vi.mocked(saveAssignmentAttemptDraft).mockClear();

    rerender({ content: '', quizAnswersValue: [], assessmentAnswersValue: [] });
    await act(async () => {
      vi.advanceTimersByTime(1200);
      await Promise.resolve();
    });

    expect(saveAssignmentAttemptDraft).not.toHaveBeenCalled();
    expect(localStorage.getItem('assignment-attempt-draft:assignment-1:student-1')).toBeNull();
  });

  it('does not hydrate stale server drafts over answers typed while loading', async () => {
    let resolveDraft: (draft: any) => void = () => {};
    const pendingDraft = new Promise<any>((resolve) => {
      resolveDraft = resolve;
    });
    vi.mocked(getAssignmentAttemptDraft).mockReturnValue(pendingDraft);
    const onHydrate = vi.fn();
    const quizAnswers: any[] = [];
    const assessmentAnswers: any[] = [];

    const { rerender } = renderHook(
      ({ content }) =>
        useAssignmentAttemptAutosave({
          enabled: true,
          assignmentId: 'assignment-1',
          studentId: 'student-1',
          content,
          quizAnswers,
          assessmentAnswers,
          onHydrate,
        }),
      { initialProps: { content: '' } }
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender({ content: 'Typed after open' });

    await act(async () => {
      resolveDraft({
        id: 'draft-1',
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        studentName: 'Student',
        classId: 'class-1',
        teacherId: 'teacher-1',
        ownerUid: 'user-1',
        content: 'Older server draft',
        quizAnswers: [],
        assessmentAnswers: [],
        attemptNumber: 1,
        status: 'in_progress',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T01:00:00.000Z',
      });
      await pendingDraft;
      await Promise.resolve();
    });

    expect(onHydrate).not.toHaveBeenCalled();
    expect(localStorage.getItem('assignment-attempt-draft:assignment-1:student-1')).toContain(
      'Typed after open'
    );
  });

  it('does not hydrate stale server drafts after answers change back to their initial value', async () => {
    let resolveDraft: (draft: any) => void = () => {};
    const pendingDraft = new Promise<any>((resolve) => {
      resolveDraft = resolve;
    });
    vi.mocked(getAssignmentAttemptDraft).mockReturnValue(pendingDraft);
    const onHydrate = vi.fn();
    const quizAnswers: any[] = [];
    const assessmentAnswers: any[] = [];

    const { rerender } = renderHook(
      ({ content }) =>
        useAssignmentAttemptAutosave({
          enabled: true,
          assignmentId: 'assignment-1',
          studentId: 'student-1',
          content,
          quizAnswers,
          assessmentAnswers,
          onHydrate,
        }),
      { initialProps: { content: '' } }
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender({ content: 'Typed then removed' });
    rerender({ content: '' });

    await act(async () => {
      resolveDraft({
        id: 'draft-1',
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        studentName: 'Student',
        classId: 'class-1',
        teacherId: 'teacher-1',
        ownerUid: 'user-1',
        content: 'Older server draft',
        quizAnswers: [],
        assessmentAnswers: [],
        attemptNumber: 1,
        status: 'in_progress',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T01:00:00.000Z',
      });
      await pendingDraft;
      await Promise.resolve();
    });

    expect(onHydrate).not.toHaveBeenCalled();
  });
});
