// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import type { TelemetryEnvelopeV1 } from '../../../../../packages/contracts/src/telemetry.js';
import type {
  BrowserSpoolRecord,
  BrowserSpoolStore
} from '../../../../../packages/telemetry-sdk/src/browserSpool.js';
import {
  createOpsBrowserRuntimeTelemetry,
  installOpsBrowserRuntimeTelemetry,
  readOpsBrowserTelemetryConfig
} from './runtimeTelemetry.js';

function memoryStore(trace: string[]): BrowserSpoolStore & { records: BrowserSpoolRecord[] } {
  const records: BrowserSpoolRecord[] = [];
  return {
    records,
    list: async () => [...records],
    put: async (record) => {
      trace.push('enqueue');
      const index = records.findIndex(
        (candidate) => candidate.idempotencyKey === record.idempotencyKey
      );
      if (index >= 0) records[index] = record;
      else records.push(record);
    },
    remove: async (idempotencyKey) => {
      const index = records.findIndex((candidate) => candidate.idempotencyKey === idempotencyKey);
      if (index >= 0) records.splice(index, 1);
    }
  };
}

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe('Ops browser runtime telemetry', () => {
  it('requires complete public browser telemetry configuration in production', () => {
    expect(() => readOpsBrowserTelemetryConfig({}, true)).toThrow(
      'Ops browser telemetry must be enabled in production'
    );
    expect(
      readOpsBrowserTelemetryConfig(
        {
          VITE_OPS_BROWSER_TELEMETRY_ENABLED: 'true',
          VITE_OPS_BROWSER_INGEST_URL: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
          VITE_OPS_BROWSER_PROJECT_KEY: 'ops-web-public-key',
          VITE_APP_RELEASE_SHA: '0123456789abcdef0123456789abcdef01234567'
        },
        true
      )
    ).toEqual({
      enabled: true,
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
      projectKey: 'ops-web-public-key',
      release: '0123456789abcdef0123456789abcdef01234567'
    });
    for (const suffix of ['?redirect=https://evil.invalid', '#fragment']) {
      expect(() =>
        readOpsBrowserTelemetryConfig(
          {
            VITE_OPS_BROWSER_TELEMETRY_ENABLED: 'true',
            VITE_OPS_BROWSER_INGEST_URL: `https://man.thienuy.edu.vn/api/v1/ingest/browser${suffix}`,
            VITE_OPS_BROWSER_PROJECT_KEY: 'ops-web-public-key',
            VITE_APP_RELEASE_SHA: '0123456789abcdef0123456789abcdef01234567'
          },
          true
        )
      ).toThrow('Ops browser telemetry ingest URL is invalid');
    }
  });

  it('deduplicates one Error, queues it before transport, and contains transport failure', async () => {
    const trace: string[] = [];
    const store = memoryStore(trace);
    const telemetry = createOpsBrowserRuntimeTelemetry({
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
      projectKey: 'ops-web-public-key',
      release: '0123456789abcdef0123456789abcdef01234567',
      spoolStore: store,
      fetch: async () => {
        trace.push('transport');
        throw new Error('offline');
      }
    });
    const error = new Error('render failed');

    const first = telemetry.captureException(error, {
      code: 'OPS_WEB_RENDER_FAILED',
      source: 'browser'
    });
    const second = telemetry.captureException(error, {
      code: 'OPS_WEB_OUTER_FAILED',
      source: 'browser'
    });
    await telemetry.flush();

    expect(first).toBe(second);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]?.eventId).toBe(first);
    expect(trace[0]).toBe('enqueue');
    expect(trace).toContain('transport');
  });

  it('marks a failed durable enqueue degraded without leaking a rejection', async () => {
    const delivered: TelemetryEnvelopeV1[] = [];
    const telemetry = createOpsBrowserRuntimeTelemetry({
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
      projectKey: 'ops-web-public-key',
      release: '0123456789abcdef0123456789abcdef01234567',
      spoolStore: {
        list: async () => {
          throw new Error('IndexedDB open failed');
        },
        put: async () => undefined,
        remove: async () => undefined
      },
      fetch: async (_input, init) => {
        delivered.push(JSON.parse(String(init?.body)) as TelemetryEnvelopeV1);
        return new Response(null, { status: 202 });
      }
    });

    let eventId: `EVT_${string}` | undefined;
    expect(() => {
      eventId = telemetry.captureException(new Error('originating render failure'), {
        code: 'RENDER_FAILED',
        source: 'browser'
      });
    }).not.toThrow();
    await expect(telemetry.flush()).resolves.toBeUndefined();
    expect(telemetry.healthy()).toBe(false);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      eventId,
      idempotencyKey: eventId,
      error: { code: 'RENDER_FAILED', safeMessage: 'originating render failure' }
    });
  });

  it('switches away from a corrupt persisted row and still attempts the exact delivery', async () => {
    const delivered: TelemetryEnvelopeV1[] = [];
    let primaryPuts = 0;
    const telemetry = createOpsBrowserRuntimeTelemetry({
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
      projectKey: 'ops-web-public-key',
      release: '0123456789abcdef0123456789abcdef01234567',
      spoolStore: {
        list: async () => [{} as never],
        put: async () => {
          primaryPuts += 1;
        },
        remove: async () => undefined
      },
      fetch: async (_input, init) => {
        delivered.push(JSON.parse(String(init?.body)) as TelemetryEnvelopeV1);
        return new Response(null, { status: 202 });
      }
    });
    const eventId = telemetry.captureException(new Error('render after corrupt row'), {
      code: 'RENDER_AFTER_CORRUPT_SPOOL',
      source: 'browser'
    });

    await expect(telemetry.flush()).resolves.toBeUndefined();

    expect(telemetry.healthy()).toBe(false);
    expect(primaryPuts).toBe(0);
    expect(delivered).toMatchObject([{ eventId, idempotencyKey: eventId }]);
  });

  it('retains and degrades on an HTTP 200 proxy response but removes after exact 202', async () => {
    const rejectedStore = memoryStore([]);
    const rejected = createOpsBrowserRuntimeTelemetry({
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
      projectKey: 'ops-web-public-key',
      release: '0123456789abcdef0123456789abcdef01234567',
      spoolStore: rejectedStore,
      fetch: async () => new Response('<html>login</html>', { status: 200 })
    });
    rejected.captureException(new Error('must survive false acknowledgment'), {
      code: 'FALSE_ACK',
      source: 'browser'
    });
    await rejected.flush();
    expect(rejectedStore.records).toHaveLength(1);
    expect(rejected.healthy()).toBe(false);

    const acceptedStore = memoryStore([]);
    const accepted = createOpsBrowserRuntimeTelemetry({
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
      projectKey: 'ops-web-public-key',
      release: '0123456789abcdef0123456789abcdef01234567',
      spoolStore: acceptedStore,
      fetch: async () => new Response(null, { status: 202 })
    });
    accepted.captureException(new Error('accepted occurrence'), {
      code: 'ACCEPTED',
      source: 'browser'
    });
    await accepted.flush();
    expect(acceptedStore.records).toHaveLength(0);
    expect(accepted.healthy()).toBe(true);
  });

  it('retains an occurrence when a 202 response is malformed, rejected, or acknowledges another event', async () => {
    const invalidReplies = [
      '{',
      JSON.stringify({ accepted: false, eventId: 'EVT_00000000000000000000000000' }),
      JSON.stringify({ accepted: true, eventId: 'EVT_00000000000000000000000000' })
    ];

    for (const reply of invalidReplies) {
      const store = memoryStore([]);
      const telemetry = createOpsBrowserRuntimeTelemetry({
        endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
        projectKey: 'ops-web-public-key',
        release: '0123456789abcdef0123456789abcdef01234567',
        spoolStore: store,
        fetch: async () =>
          new Response(reply, {
            status: 202,
            headers: { 'Content-Type': 'application/json' }
          })
      });
      const eventId = telemetry.captureException(new Error('must survive false acknowledgment'), {
        code: 'FALSE_ACK_CONTRACT',
        source: 'browser'
      });

      await telemetry.flush();

      expect(eventId).not.toBe('EVT_00000000000000000000000000');
      expect(store.records).toHaveLength(1);
      expect(store.records[0]?.eventId).toBe(eventId);
      expect(telemetry.healthy()).toBe(false);
    }
  });

  it('installs one listener set, preserves escaped values, and removes it without leaks', () => {
    const captured: unknown[] = [];
    let flushes = 0;
    const runtime = {
      captureException: (error: unknown) => {
        captured.push(error);
        return 'EVT_00000000000000000000000000' as const;
      },
      flush: async () => {
        flushes += 1;
      },
      healthy: () => true
    };

    const firstDispose = installOpsBrowserRuntimeTelemetry(runtime, { window, document });
    const secondDispose = installOpsBrowserRuntimeTelemetry(runtime, { window, document });
    disposers.push(firstDispose, secondDispose);
    const error = new Error('window failure');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    const reason = { kind: 'lost-rejection' };
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: reason });
    window.dispatchEvent(rejection);
    window.dispatchEvent(new Event('online'));

    expect(captured).toEqual([error, reason]);
    expect(flushes).toBe(1);

    firstDispose();
    const afterOlderDispose = new Error('newer binding remains active');
    window.dispatchEvent(
      new ErrorEvent('error', { error: afterOlderDispose, message: afterOlderDispose.message })
    );
    expect(captured).toEqual([error, reason, afterOlderDispose]);
    secondDispose();
    window.dispatchEvent(new Event('online'));
    expect(captured).toEqual([error, reason, afterOlderDispose]);
    expect(flushes).toBe(1);
  });

  it('routes lifecycle events to the newest binding for their exact Window target', () => {
    const firstWindow = Object.assign(new EventTarget(), {
      location: { pathname: '/first' }
    }) as unknown as Window;
    const secondWindow = Object.assign(new EventTarget(), {
      location: { pathname: '/second' }
    }) as unknown as Window;
    const firstDocument = Object.assign(new EventTarget(), {
      visibilityState: 'visible'
    }) as unknown as Document;
    const secondDocument = Object.assign(new EventTarget(), {
      visibilityState: 'visible'
    }) as unknown as Document;
    const firstCaptured: unknown[] = [];
    const secondCaptured: unknown[] = [];
    const runtime = (captured: unknown[]) => ({
      captureException: (error: unknown) => {
        captured.push(error);
        return 'EVT_00000000000000000000000000' as const;
      },
      flush: async () => undefined,
      healthy: () => true
    });
    const disposeFirst = installOpsBrowserRuntimeTelemetry(runtime(firstCaptured), {
      window: firstWindow,
      document: firstDocument
    });
    const disposeSecond = installOpsBrowserRuntimeTelemetry(runtime(secondCaptured), {
      window: secondWindow,
      document: secondDocument
    });
    disposers.push(disposeFirst, disposeSecond);
    const firstError = new Error('first target failure');
    const secondError = new Error('second target failure');

    firstWindow.dispatchEvent(new ErrorEvent('error', { error: firstError }));
    secondWindow.dispatchEvent(new ErrorEvent('error', { error: secondError }));

    expect(firstCaptured).toEqual([firstError]);
    expect(secondCaptured).toEqual([secondError]);
  });
});
