// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Class } from '../../types';
import { useClosedCourseJoin } from './useClosedCourseJoin';

const runningClass = {
  id: 'class-open',
  name: 'Toán 9A',
  startDate: '2026-07-01',
  endDate: '2026-09-30',
} as Class;
const endedClass = {
  id: 'class-ended',
  name: 'Toán 8B',
  startDate: '2026-01-05',
  endDate: '2026-03-31',
} as Class;
const legacyClass = { id: 'class-legacy', name: 'Cũ' } as Class;

describe('useClosedCourseJoin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('proceeds without a date and modal for a running course', () => {
    vi.setSystemTime(new Date('2026-08-01T03:00:00.000Z'));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useClosedCourseJoin());
    act(() => result.current.guard(runningClass, onProceed));
    expect(onProceed).toHaveBeenCalledWith(undefined);
    expect(result.current.isOpen).toBe(false);
  });

  it('proceeds for a legacy class with no course dates', () => {
    vi.setSystemTime(new Date('2026-08-01T03:00:00.000Z'));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useClosedCourseJoin());
    act(() => result.current.guard(legacyClass, onProceed));
    expect(onProceed).toHaveBeenCalledWith(undefined);
  });

  it('holds the action back and opens for an ended course', () => {
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useClosedCourseJoin());
    act(() => result.current.guard(endedClass, onProceed));
    expect(onProceed).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(true);
  });

  it('opens for an approved closing inside the date range', () => {
    vi.setSystemTime(new Date('2026-08-01T03:00:00.000Z'));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useClosedCourseJoin());
    act(() =>
      result.current.guard({ ...runningClass, courseClosingApproved: true } as Class, onProceed)
    );
    expect(onProceed).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(true);
  });

  it('runs the held action with the confirmed date', async () => {
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useClosedCourseJoin());
    act(() => result.current.guard(endedClass, onProceed));
    await act(async () => result.current.confirmCurrentTerm('2026-02-10'));
    expect(onProceed).toHaveBeenCalledWith('2026-02-10');
    expect(result.current.isOpen).toBe(false);
  });

  it('drops the held action when dismissed', () => {
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    const onProceed = vi.fn();
    const { result } = renderHook(() => useClosedCourseJoin());
    act(() => result.current.guard(endedClass, onProceed));
    act(() => result.current.close());
    expect(onProceed).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
  });
});
