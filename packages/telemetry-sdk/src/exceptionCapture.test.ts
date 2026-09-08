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

  it('merges a provisional lower boundary into one terminal outer occurrence', async () => {
    const reports: Array<{ error: Error; context: Record<string, unknown> }> = [];
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000009',
      capture: (error, context) => {
        reports.push({ error, context });
      }
    });
    const error = new Error('database lookup failed');

    const lowerId = capture.captureOnce(error, {
      code: 'LOWER_GENERIC',
      source: 'database',
      deferUntilHandled: true
    });
    const outerId = capture.captureOnce(error, {
      code: 'ROUTE_FAILED',
      source: 'api',
      route: '/api/v1/users',
      requestId: 'REQ_00000000000000000000000000',
      tags: { method: 'GET' }
    });
    await capture.flush();

    expect(outerId).toBe(lowerId);
    expect(reports).toEqual([
      {
        error,
        context: {
          eventId: lowerId,
          code: 'ROUTE_FAILED',
          source: 'api',
          route: '/api/v1/users',
          requestId: 'REQ_00000000000000000000000000',
          tags: { method: 'GET' }
        }
      }
    ]);
  });

  it('terminalizes deferred occurrences on graceful flush when there is no outer owner', async () => {
    const reports: string[] = [];
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000010',
      capture: (_error, context) => {
        reports.push(context.code);
      }
    });

    capture.captureOnce(new Error('lower failure'), {
      code: 'DATABASE_QUERY_FAILED',
      source: 'database',
      deferUntilHandled: true
    });
    expect(reports).toEqual([]);

    await capture.flush();

    expect(reports).toEqual(['DATABASE_QUERY_FAILED']);
  });

  it('keeps specific provenance and maximum severity under a generic process terminal owner', async () => {
    const reports: Array<Record<string, unknown>> = [];
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000011',
      capture: (_error, context) => {
        reports.push(context);
      }
    });
    const error = new Error('database unavailable');

    capture.captureOnce(error, {
      code: 'DATABASE_QUERY_FAILED',
      source: 'database',
      level: 'fatal',
      tags: { phase: 'query' },
      deferUntilHandled: true
    });
    capture.captureOnce(error, {
      code: 'PROCESS_UNCAUGHT_EXCEPTION',
      source: 'process',
      level: 'error',
      route: '/runtime',
      tags: { owner: 'process' }
    });
    await capture.flush();

    expect(reports).toEqual([
      {
        eventId: 'EVT_00000000000000000000000011',
        code: 'DATABASE_QUERY_FAILED',
        source: 'database',
        level: 'fatal',
        route: '/runtime',
        tags: { phase: 'query', owner: 'process' }
      }
    ]);
  });

  it('keeps one identity for the same thrown object across nested normalization', async () => {
    const reports: Array<{ error: Error; code: string }> = [];
    let sequence = 0;
    const capture = createExceptionCapture({
      createEventId: () => `EVT_OBJECT_${++sequence}`,
      capture: (error, context) => {
        reports.push({ error, code: context.code });
      }
    });
    const thrown = { reason: 'connection reset' };

    const lower = capture.captureOnce(thrown, {
      code: 'UNHANDLED_OPS_EXCEPTION',
      source: 'provider',
      deferUntilHandled: true
    });
    const outer = capture.captureOnce(thrown, { code: 'REQUEST_FAILED', source: 'api' });
    await capture.flush();

    expect(outer).toBe(lower);
    expect(reports).toHaveLength(1);
  });

  it('supports explicit sibling, forced, and future occurrences when an Error is reused', async () => {
    const reports: string[] = [];
    let sequence = 0;
    const capture = createExceptionCapture({
      createEventId: () => `EVT_REUSED_${++sequence}`,
      capture: (_error, context) => {
        reports.push(context.eventId);
      }
    });
    const reused = new Error('reused by independent operations');

    const primary = capture.captureOnce(reused, {
      code: 'PRIMARY_FAILED',
      source: 'job'
    });
    const sibling = capture.captureOnce(reused, {
      code: 'CLEANUP_FAILED',
      source: 'process',
      distinctFrom: reused
    });
    const forced = capture.captureOnce(reused, {
      code: 'RETRY_FAILED',
      source: 'job',
      forceNewOccurrence: true
    });
    const reusableLater = new Error('reused after an explicitly closed attempt');
    const beforeFuture = capture.captureOnce(reusableLater, {
      code: 'ATTEMPT_FAILED',
      source: 'job',
      allowFutureOccurrence: true
    });
    const future = capture.captureOnce(reusableLater, {
      code: 'LATER_OPERATION_FAILED',
      source: 'job'
    });
    await capture.flush();

    expect(new Set([primary, sibling, forced, beforeFuture, future]).size).toBe(5);
    expect(reports).toEqual([primary, sibling, forced, beforeFuture, future]);
  });

  it('allows reuse after a forced occurrence closes the previous Error lifecycle', async () => {
    const reports: string[] = [];
    let sequence = 0;
    const capture = createExceptionCapture({
      createEventId: () => `EVT_FORCE_RESET_${++sequence}`,
      capture: (_error, context) => {
        reports.push(context.eventId);
      }
    });
    const reused = new Error('reused across completed operations');

    const first = capture.captureOnce(reused, {
      code: 'FIRST_OPERATION_FAILED',
      source: 'job'
    });
    const forced = capture.captureOnce(reused, {
      code: 'FORCED_RETRY_FAILED',
      source: 'job',
      forceNewOccurrence: true,
      allowFutureOccurrence: true
    });
    const future = capture.captureOnce(reused, {
      code: 'FUTURE_OPERATION_FAILED',
      source: 'job'
    });
    await capture.flush();

    expect(new Set([first, forced, future]).size).toBe(3);
    expect(reports).toEqual([first, forced, future]);
  });

  it('resolves deferred terminal metadata and contains hostile accessors', async () => {
    const reports: Array<Record<string, unknown>> = [];
    const capture = createExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000015',
      capture: (_error, context) => {
        reports.push(context);
      }
    });

    capture.captureOnce(new Error('request failed'), {
      code: 'ROUTE_FAILED',
      source: 'api',
      requestId: () => 'REQ_00000000000000000000000000',
      route: () => {
        throw new Error('hostile request URL getter');
      },
      traceId: () => 'trace-15',
      componentStack: () => 42
    });
    await capture.flush();

    expect(reports).toEqual([
      {
        eventId: 'EVT_00000000000000000000000015',
        code: 'ROUTE_FAILED',
        source: 'api',
        requestId: 'REQ_00000000000000000000000000',
        traceId: 'trace-15'
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
