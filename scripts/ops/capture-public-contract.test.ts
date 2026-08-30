import { describe, expect, it, vi } from 'vitest';

import {
  buildPublicContract,
  capturePublicContract,
  serializePublicContract,
  validatePublicContract
} from './capture-public-contract.mjs';

const rootResponse = {
  method: 'GET',
  route: '/',
  status: 200,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    ETag: 'unstable-and-not-security-evidence',
    'X-Content-Type-Options': 'nosniff'
  },
  body: `<!doctype html><html lang="vi"><head>
    <meta name="robots" content="noindex,nofollow">
    <title>Thien Uy Ops Console</title>
  </head><body><div id="root"></div></body></html>`
};

const unauthorizedResponse = (route: '/api/session' | '/api/overview') => ({
  method: 'GET',
  route,
  status: 401,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY'
  },
  body: '{"error":"unauthorized"}'
});

const expectedContract = {
  schemaVersion: 1,
  entries: [
    {
      route: { method: 'GET', path: '/' },
      status: 200,
      jsonShape: null,
      securityHeaders: {
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff'
      },
      uiLandmarks: [
        '#root',
        'html[lang=vi]',
        'meta[name=robots][content=noindex,nofollow]',
        'title=Thien Uy Ops Console'
      ]
    },
    {
      route: { method: 'GET', path: '/api/overview' },
      status: 401,
      jsonShape: {
        type: 'object',
        keys: { error: { type: 'string' } }
      },
      securityHeaders: { 'cache-control': 'no-store', 'x-frame-options': 'DENY' },
      uiLandmarks: []
    },
    {
      route: { method: 'GET', path: '/api/session' },
      status: 401,
      jsonShape: {
        type: 'object',
        keys: { error: { type: 'string' } }
      },
      securityHeaders: { 'cache-control': 'no-store', 'x-frame-options': 'DENY' },
      uiLandmarks: []
    }
  ]
};

async function rejectionCodeWithin(promise: Promise<unknown>, timeoutMs = 750): Promise<string> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => 'TEST_UNEXPECTED_RESOLUTION',
        (error: unknown) => (error instanceof Error ? error.message : 'TEST_NON_ERROR_REJECTION')
      ),
      new Promise<string>((resolve) => {
        watchdog = setTimeout(() => resolve('TEST_WATCHDOG_EXPIRED'), timeoutMs);
      })
    ]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}

describe('Ops public-contract capture', () => {
  it('reduces shuffled fixtures to a deterministic route/status/shape/header/landmark allowlist', () => {
    const contract = buildPublicContract([
      unauthorizedResponse('/api/session'),
      rootResponse,
      unauthorizedResponse('/api/overview')
    ]);

    expect(contract).toEqual(expectedContract);
    expect(serializePublicContract(contract)).toBe(
      `${JSON.stringify(expectedContract, null, 2)}\n`
    );
    expect(JSON.stringify(contract)).not.toContain('unauthorized');
    expect(JSON.stringify(contract)).not.toContain('ETag');
  });

  it('rejects unknown contract fields and non-canonical ordering instead of silently dropping them', () => {
    const withUnknown = structuredClone(expectedContract) as typeof expectedContract & {
      capturedAt?: string;
    };
    withUnknown.capturedAt = '2026-08-30T00:00:00Z';
    expect(() => validatePublicContract(withUnknown)).toThrow('PUBLIC_CONTRACT_SCHEMA_INVALID');

    const reversed = structuredClone(expectedContract);
    reversed.entries.reverse();
    expect(() => validatePublicContract(reversed)).toThrow('PUBLIC_CONTRACT_NOT_CANONICAL');

    const invalidStatus = structuredClone(expectedContract);
    invalidStatus.entries[0]!.status = 999;
    expect(() => validatePublicContract(invalidStatus)).toThrow('PUBLIC_CONTRACT_SCHEMA_INVALID');

    const nonCanonicalShape = structuredClone(expectedContract);
    nonCanonicalShape.entries[1]!.jsonShape = {
      type: 'object',
      keys: { zed: { type: 'string' }, alpha: { type: 'number' } }
    };
    expect(() => validatePublicContract(nonCanonicalShape)).toThrow(
      'PUBLIC_CONTRACT_NOT_CANONICAL'
    );

    const nonCanonicalArrayShape = structuredClone(expectedContract);
    nonCanonicalArrayShape.entries[1]!.jsonShape = {
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }]
    };
    expect(() => validatePublicContract(nonCanonicalArrayShape)).toThrow(
      'PUBLIC_CONTRACT_NOT_CANONICAL'
    );
  });

  it.each([
    ['nested username', { body: '{"profile":{"UsErNaMe":"operator-a"}}' }],
    ['plural usernames', { body: '{"profiles":{"usernames":["operator-a"]}}' }],
    ['plural cookies', { body: '{"cookies":["private"]}' }],
    ['raw incidents', { body: '{"incidents":[{"summary":"private outage detail"}]}' }],
    ['base64 encoded key', { body: '{"c2Vzc2lvbg==":"value"}' }],
    ['mixed-case CSRF', { body: '{"CsRfToKeN":"value"}' }],
    ['session material', { body: '{"nested":{"session":"value"}}' }],
    ['MFA material', { body: '{"mFa":{"code":"123456"}}' }],
    ['Zalo identifier', { body: '{"channel":"zAlO-chat-123"}' }],
    ['raw incident note', { body: '{"incident":{"NoTe":"private outage detail"}}' }],
    ['encoded database path', { body: '{"error":"%2Fsrv%2Fedutrack-ops%2Fshared%2Fops.sqlite"}' }],
    ['encoded secret', { body: '{"error":"c2VjcmV0"}' }],
    ['SQL payload', { body: '{"query":"SELECT * FROM accounts"}' }],
    ['telemetry payload', { body: '{"telemetry":{"payload":{"cpu":42}}}' }],
    ['timestamp', { body: '{"observedAt":"2026-08-30T00:00:00Z"}' }],
    ['unstable ID', { body: '{"incidentId":"550e8400-e29b-41d4-a716-446655440000"}' }],
    ['cookie header', { headers: { 'SeT-CoOkIe': '__Host-ops_session=private' } }]
  ])('rejects %s before reducing the response', (_name, mutation) => {
    const fixture = {
      ...unauthorizedResponse('/api/session'),
      ...mutation,
      headers: {
        ...unauthorizedResponse('/api/session').headers,
        ...(mutation.headers ?? {})
      }
    };
    expect(() =>
      buildPublicContract([rootResponse, unauthorizedResponse('/api/overview'), fixture])
    ).toThrow('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
  });

  it.each([
    ['percent then standard base64 retained key', { body: '{"c2VjcmV0IMK%2B":"value"}' }],
    ['percent then base64url retained key', { body: '{"c2VjcmV0IMK%2D":"value"}' }],
    [
      'percent then standard base64 selected header',
      { headers: { 'cache-control': 'c2VjcmV0IMK%2B' } }
    ],
    ['percent then base64url selected header', { headers: { 'cache-control': 'c2VjcmV0IMK%2D' } }]
  ])('rejects composed encoding in %s', (_name, mutation) => {
    const fixture = {
      ...unauthorizedResponse('/api/session'),
      ...mutation,
      headers: {
        ...unauthorizedResponse('/api/session').headers,
        ...(mutation.headers ?? {})
      }
    };
    expect(() =>
      buildPublicContract([rootResponse, unauthorizedResponse('/api/overview'), fixture])
    ).toThrow('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
  });

  it.each([
    ['user_name', 'user_name=operator-a'],
    ['ISO offset timestamp', 'at=2026-08-30T07:00:00+07:00'],
    ['zoneless ISO timestamp', 'at=2026-08-30T07:00:00']
  ])('rejects prohibited %s in a retained header', (_name, value) => {
    const fixture = {
      ...unauthorizedResponse('/api/session'),
      headers: { ...unauthorizedResponse('/api/session').headers, 'cache-control': value }
    };
    expect(() =>
      buildPublicContract([rootResponse, unauthorizedResponse('/api/overview'), fixture])
    ).toThrow('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
  });

  it.each([
    ['/api/%73ession', 'PUBLIC_CONTRACT_ROUTE_INVALID'],
    ['/api/session?next=%2F', 'PUBLIC_CONTRACT_ROUTE_INVALID'],
    ['//api/session', 'PUBLIC_CONTRACT_ROUTE_INVALID']
  ])('rejects malformed or encoded route bypass %s', (route, error) => {
    expect(() =>
      buildPublicContract([
        rootResponse,
        unauthorizedResponse('/api/overview'),
        { ...unauthorizedResponse('/api/session'), route }
      ])
    ).toThrow(error);
  });

  it('uses an injected fixture transport, sends no credentials, and contacts only the fixed anonymous routes', async () => {
    const fixtures = new Map([
      ['/', rootResponse],
      ['/api/session', unauthorizedResponse('/api/session')],
      ['/api/overview', unauthorizedResponse('/api/overview')]
    ]);
    const fetchFixture = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
      expect(new Headers(init?.headers).get('cookie')).toBeNull();
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      const fixture = fixtures.get(url.pathname)!;
      return new Response(fixture.body, { status: fixture.status, headers: fixture.headers });
    });

    await expect(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        fetchImpl: fetchFixture,
        timeoutMs: 2000,
        bodyCapBytes: 65_536
      })
    ).resolves.toEqual(expectedContract);
    expect(fetchFixture.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/',
      '/api/session',
      '/api/overview'
    ]);
  });

  it('fails closed on a non-production loopback target, oversized body, redirect or unexpected status', async () => {
    await expect(
      capturePublicContract({
        baseUrl: 'http://localhost:3101',
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow('PUBLIC_CONTRACT_BASE_URL_INVALID');

    await expect(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        bodyCapBytes: 16,
        fetchImpl: vi.fn(async () => new Response('x'.repeat(17), { status: 200 }))
      })
    ).rejects.toThrow('PUBLIC_CONTRACT_BODY_TOO_LARGE');

    await expect(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        fetchImpl: vi.fn(async () => new Response('', { status: 302 }))
      })
    ).rejects.toThrow('PUBLIC_CONTRACT_STATUS_MISMATCH');

    await expect(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        fetchImpl: vi.fn(async (input) => {
          const route = new URL(String(input)).pathname;
          if (route === '/')
            return new Response(rootResponse.body, {
              status: rootResponse.status,
              headers: rootResponse.headers
            });
          return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        })
      })
    ).rejects.toThrow('PUBLIC_CONTRACT_STATUS_MISMATCH');
  });

  it('keeps the per-contact deadline active while a headers-fast response body stalls', async () => {
    const onContact = vi.fn();
    const startedAt = Date.now();
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<!doctype html>'));
      }
    });

    await expect(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 100,
        onContact,
        fetchImpl: vi.fn(
          async () =>
            new Response(stalled, {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' }
            })
        )
      })
    ).rejects.toThrow('PUBLIC_CONTRACT_CONTACT_TIMEOUT');
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(onContact).not.toHaveBeenCalled();
  });

  it('enforces the contact deadline when the transport ignores AbortSignal', async () => {
    const onContact = vi.fn();
    const code = await rejectionCodeWithin(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 100,
        onContact,
        fetchImpl: vi.fn(() => new Promise<Response>(() => {}))
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_CONTACT_TIMEOUT');
    expect(onContact).not.toHaveBeenCalled();
  });

  it('does not let a never-settling cancellation extend a stalled-body deadline', async () => {
    const onContact = vi.fn();
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<!doctype html>'));
      },
      cancel: () => new Promise<void>(() => {})
    });
    const code = await rejectionCodeWithin(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 100,
        onContact,
        fetchImpl: vi.fn(
          async () =>
            new Response(stalled, {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' }
            })
        )
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_CONTACT_TIMEOUT');
    expect(onContact).not.toHaveBeenCalled();
  });

  it('does not let a never-settling cancellation extend the body cap failure', async () => {
    const onContact = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(17));
      },
      cancel: () => new Promise<void>(() => {})
    });
    const code = await rejectionCodeWithin(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 500,
        bodyCapBytes: 16,
        onContact,
        fetchImpl: vi.fn(async () => new Response(oversized, { status: 200 }))
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_BODY_TOO_LARGE');
    expect(onContact).not.toHaveBeenCalled();
  });
});
