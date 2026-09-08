import { describe, expect, it } from 'vitest';

import { createBrowserExceptionCapture } from './exceptionCapture.browser.js';

describe('browser exception capture ownership', () => {
  it('merges a provisional nested boundary into one terminal ErrorBoundary occurrence', async () => {
    const reports: Array<Record<string, unknown>> = [];
    const capture = createBrowserExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000012',
      capture: (_error, context) => {
        reports.push(context);
      }
    });
    const error = new Error('nested render query failed');

    const lower = capture.captureOnce(error, {
      code: 'UNHANDLED_BROWSER_EXCEPTION',
      source: 'browser',
      deferUntilHandled: true
    });
    const outer = capture.captureOnce(error, {
      code: 'OPS_WEB_REACT_ERROR_BOUNDARY',
      source: 'browser',
      route: '/overview',
      componentStack: 'at OverviewPage'
    });
    await capture.flush();

    expect(outer).toBe(lower);
    expect(reports).toEqual([
      {
        eventId: lower,
        code: 'OPS_WEB_REACT_ERROR_BOUNDARY',
        source: 'browser',
        route: '/overview',
        componentStack: 'at OverviewPage'
      }
    ]);
  });

  it('terminalizes a provisional browser occurrence during graceful flush', async () => {
    const reports: string[] = [];
    const capture = createBrowserExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000013',
      capture: (_error, context) => {
        reports.push(context.code);
      }
    });
    capture.captureOnce(new Error('deferred browser failure'), {
      code: 'BROWSER_REQUEST_FAILED',
      source: 'browser',
      deferUntilHandled: true
    });
    expect(reports).toEqual([]);

    await capture.flush();

    expect(reports).toEqual(['BROWSER_REQUEST_FAILED']);
  });

  it('normalizes a repeated thrown object stably and allows an explicit future occurrence', async () => {
    const reports: string[] = [];
    let sequence = 0;
    const capture = createBrowserExceptionCapture({
      createEventId: () => `EVT_BROWSER_${++sequence}`,
      capture: (_error, context) => {
        reports.push(context.eventId);
      }
    });
    const thrown = { failure: 'offline' };

    const provisional = capture.captureOnce(thrown, {
      code: 'UNHANDLED_BROWSER_EXCEPTION',
      source: 'browser',
      deferUntilHandled: true
    });
    const terminal = capture.captureOnce(thrown, {
      code: 'OPS_WEB_ERROR_BOUNDARY',
      source: 'browser',
      allowFutureOccurrence: true
    });
    const future = capture.captureOnce(thrown, {
      code: 'OPS_WEB_RETRY_FAILED',
      source: 'browser'
    });
    await capture.flush();

    expect(terminal).toBe(provisional);
    expect(future).not.toBe(terminal);
    expect(reports).toEqual([terminal, future]);
  });

  it('allows reuse after a forced browser occurrence closes the previous Error lifecycle', async () => {
    const reports: string[] = [];
    let sequence = 0;
    const capture = createBrowserExceptionCapture({
      createEventId: () => `EVT_BROWSER_FORCE_RESET_${++sequence}`,
      capture: (_error, context) => {
        reports.push(context.eventId);
      }
    });
    const reused = new Error('reused across browser operations');

    const first = capture.captureOnce(reused, {
      code: 'FIRST_BROWSER_OPERATION_FAILED',
      source: 'browser'
    });
    const forced = capture.captureOnce(reused, {
      code: 'FORCED_BROWSER_RETRY_FAILED',
      source: 'browser',
      forceNewOccurrence: true,
      allowFutureOccurrence: true
    });
    const future = capture.captureOnce(reused, {
      code: 'FUTURE_BROWSER_OPERATION_FAILED',
      source: 'browser'
    });
    await capture.flush();

    expect(new Set([first, forced, future]).size).toBe(3);
    expect(reports).toEqual([first, forced, future]);
  });

  it('resolves deferred route metadata without letting a hostile getter suppress capture', async () => {
    const reports: Array<Record<string, unknown>> = [];
    const capture = createBrowserExceptionCapture({
      createEventId: () => 'EVT_00000000000000000000000014',
      capture: (_error, context) => {
        reports.push(context);
      }
    });

    capture.captureOnce(new Error('browser request failed'), {
      code: 'BROWSER_REQUEST_FAILED',
      source: 'browser',
      route: () => {
        throw new Error('hostile location getter');
      }
    });
    await capture.flush();

    expect(reports).toEqual([
      {
        eventId: 'EVT_00000000000000000000000014',
        code: 'BROWSER_REQUEST_FAILED',
        source: 'browser'
      }
    ]);
  });
});
