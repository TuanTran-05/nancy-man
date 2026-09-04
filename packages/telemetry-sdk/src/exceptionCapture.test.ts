import { describe, expect, it } from 'vitest';

import { createExceptionCapture } from './exceptionCapture.js';

describe('exception capture', () => {
  it('waits for an in-flight capture without surfacing telemetry delivery failure', async () => {
    let releaseCapture: (() => void) | undefined;
    const delivered: string[] = [];
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000005',
      capture: async () => {
        await new Promise<void>((resolve) => {
          releaseCapture = resolve;
        });
        delivered.push('captured');
      }
    });

    capture.captureOnce(new Error('slow provider'), { code: 'PROVIDER_FAILED' });
    let flushed = false;
    const flush = capture.flush().then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);

    releaseCapture?.();
    await flush;

    expect(delivered).toEqual(['captured']);
  });

  it('reuses the Error event ID across capture helpers in one runtime', async () => {
    const error = new Error('provider token expired');
    const reports: string[] = [];
    const first = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000003',
      capture: (_error, context) => {
        reports.push(context.eventId);
      }
    });
    const second = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000004',
      capture: (_error, context) => {
        reports.push(context.eventId);
      }
    });

    expect(first.captureOnce(error, { code: 'PROVIDER_FAILED' })).toBe(
      'EVT_00000000000000000000000003'
    );
    expect(second.eventIdFor(error)).toBe('EVT_00000000000000000000000003');
    expect(second.captureOnce(error, { code: 'REQUEST_FAILED' })).toBe(
      'EVT_00000000000000000000000003'
    );

    await Promise.resolve();

    expect(reports).toEqual(['EVT_00000000000000000000000003']);
  });

  it('reports one event when the same Error reaches nested boundaries', async () => {
    const reports: Array<{ error: Error; eventId: string; code: string }> = [];
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000000',
      capture: (error, context) => {
        reports.push({ error, eventId: context.eventId, code: context.code });
      }
    });
    const error = new Error('provider token expired');

    expect(capture.captureOnce(error, { code: 'PROVIDER_FAILED' })).toBe(
      'EVT_00000000000000000000000000'
    );
    expect(capture.captureOnce(error, { code: 'REQUEST_FAILED' })).toBe(
      'EVT_00000000000000000000000000'
    );

    await Promise.resolve();

    expect(reports).toEqual([
      {
        error,
        eventId: 'EVT_00000000000000000000000000',
        code: 'PROVIDER_FAILED'
      }
    ]);
  });

  it('normalizes a non-Error rejection before it is reported', async () => {
    const reports: Error[] = [];
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000001',
      capture: (error) => {
        reports.push(error);
      }
    });

    capture.captureOnce('connection closed', { code: 'PROMISE_REJECTION' });
    await Promise.resolve();

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ name: 'Error', message: 'connection closed' });
  });

  it('does not let telemetry delivery failure replace the original exception', async () => {
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000002',
      capture: async () => {
        throw new Error('collector offline');
      }
    });

    expect(
      capture.captureOnce(new Error('application failure'), { code: 'APPLICATION_FAILED' })
    ).toBe('EVT_00000000000000000000000002');
    await Promise.resolve();
  });
});
