import { describe, expect, it, vi } from 'vitest';
import {
  drainBackgroundTasks,
  getBackgroundTaskCount,
  runInBackground,
} from './backgroundTasks.js';

describe('VPS background task registry', () => {
  it('drains work before shutdown', async () => {
    let finish!: () => void;
    const task = new Promise<void>((resolve) => {
      finish = resolve;
    });
    runInBackground(task, 'test-task');

    expect(getBackgroundTaskCount()).toBe(1);
    finish();
    expect(await drainBackgroundTasks(100)).toBe(true);
    expect(getBackgroundTaskCount()).toBe(0);
  });

  it('times out without dropping the tracked task', async () => {
    let finish!: () => void;
    const task = new Promise<void>((resolve) => {
      finish = resolve;
    });
    runInBackground(task, 'slow-test-task');

    expect(await drainBackgroundTasks(5)).toBe(false);
    expect(getBackgroundTaskCount()).toBe(1);
    finish();
    expect(await drainBackgroundTasks(100)).toBe(true);
  });

  it('consumes and logs rejected background work', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runInBackground(Promise.reject(new Error('boom')), 'test-task');

    expect(await drainBackgroundTasks(100)).toBe(true);
    expect(error).toHaveBeenCalledWith('[test-task-failed]', 'boom');
    error.mockRestore();
  });
});
