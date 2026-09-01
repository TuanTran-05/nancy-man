import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';

import {
  buildPublicContract,
  capturePublicContract,
  serializePublicContract,
  validatePublicRouteOwnership,
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
  status: 410,
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
      status: 410,
      jsonShape: {
        type: 'object',
        keys: { error: { type: 'string' } }
      },
      securityHeaders: { 'cache-control': 'no-store', 'x-frame-options': 'DENY' },
      uiLandmarks: []
    },
    {
      route: { method: 'GET', path: '/api/session' },
      status: 410,
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
  it('validates canonical route ownership and rejects a generic legacy API proxy', () => {
    const config = `
      location ^~ /api/v1/ { proxy_pass http://127.0.0.1:3100; }
      location = /api/zalo-bot/webhook { proxy_pass http://127.0.0.1:3101; }
      location = /api/session { return 410; }
      location / { proxy_pass http://127.0.0.1:3101; }
    `;
    expect(validatePublicRouteOwnership(config)).toMatchObject({
      canonicalApiPrefix: '/api/v1/',
      retiredStatus: 410
    });
    expect(() =>
      validatePublicRouteOwnership(
        `${config}\nlocation /api/ { proxy_pass http://127.0.0.1:3101; }`
      )
    ).toThrow('PUBLIC_CONTRACT_ROUTING_INVALID');
  });

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
    ['compound standard base64 shape key', { body: '{"prefix_c2VjcmV0IMK+":"value"}' }],
    ['compound base64url shape key', { body: '{"prefix_c2VjcmV0IMK-":"value"}' }],
    [
      'percent-wrapped compound base64url shape key',
      { body: '{"%70%72%65%66%69%78%5Fc2VjcmV0IMK%2D":"value"}' }
    ],
    ['short base64 shape key', { body: '{"c3Fs":"value"}' }],
    ['recoverably malformed base64 shape key', { body: '{"c2VjcmV0===":"value"}' }],
    [
      'compound standard base64 selected header',
      { headers: { 'cache-control': 'public, x=c2VjcmV0IMK+' } }
    ],
    [
      'compound base64url selected header',
      { headers: { 'cache-control': 'public, x=c2VjcmV0IMK-' } }
    ],
    [
      'percent-wrapped compound base64url selected header',
      { headers: { 'cache-control': 'public%2C%20x%3Dc2VjcmV0IMK%2D' } }
    ],
    ['short base64 selected header', { headers: { 'cache-control': 'c3Fs' } }],
    [
      'recoverably malformed base64 selected header',
      { headers: { 'cache-control': 'c2VjcmV0===' } }
    ]
  ])('rejects encoded tokens in retained %s', (_name, mutation) => {
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
    ['underscore-delimited interior shape key', { body: '{"prefix_c2VjcmV0_suffix":"value"}' }],
    ['hyphen-delimited interior shape key', { body: '{"prefix-c2VjcmV0-suffix":"value"}' }],
    ['slash-delimited interior shape key', { body: '{"prefix/c2VjcmV0/suffix":"value"}' }],
    [
      'percent-wrapped interior shape key',
      { body: '{"%70%72%65%66%69%78%5Fc2VjcmV0%5F%73%75%66%66%69%78":"value"}' }
    ],
    [
      'underscore-delimited interior selected header',
      { headers: { 'cache-control': 'prefix_c2VjcmV0_suffix' } }
    ],
    [
      'hyphen-delimited interior selected header',
      { headers: { 'cache-control': 'prefix-c2VjcmV0-suffix' } }
    ],
    [
      'slash-delimited interior selected header',
      { headers: { 'cache-control': 'prefix/c2VjcmV0/suffix' } }
    ],
    [
      'percent-wrapped interior selected header',
      {
        headers: {
          'cache-control': '%70%72%65%66%69%78%5Fc2VjcmV0%5F%73%75%66%66%69%78'
        }
      }
    ]
  ])('rejects two-sided encoded tokens in retained %s', (_name, mutation) => {
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
    [
      'decode-stage budget',
      Array.from({ length: 8 }).reduce((value) => encodeURIComponent(value), '%73ql')
    ],
    ['encoded-value length budget', 'A'.repeat(4097)],
    [
      'encoded-token count budget',
      Array.from({ length: 65 }, (_, index) => `q${index.toString(36).padStart(3, '0')}`).join(',')
    ],
    [
      'encoded-token character budget',
      Array.from({ length: 5 }, (_, index) => `${'A'.repeat(4095)}${index}`).join(',')
    ],
    [
      'decoded-variant budget',
      Array.from({ length: 33 }, (_, index) =>
        Buffer.from(`v${index.toString().padStart(2, '0')}`).toString('base64')
      ).join(',')
    ]
  ])('fails closed at the adversarial %s', (_name, retainedKey) => {
    const fixture = {
      ...unauthorizedResponse('/api/session'),
      body: JSON.stringify({ [retainedKey]: 'value' })
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
    let abortCount = 0;
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
        fetchImpl: vi.fn(async (_input, init) => {
          init?.signal?.addEventListener('abort', () => {
            abortCount += 1;
          });
          return new Response(oversized, { status: 200 });
        })
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_BODY_TOO_LARGE');
    expect(abortCount).toBe(1);
    expect(onContact).not.toHaveBeenCalled();
  });

  it('aborts and non-blockingly cancels a declared oversized response', async () => {
    const onContact = vi.fn();
    let abortCount = 0;
    let cancelCount = 0;
    const oversized = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCount += 1;
        return new Promise<void>(() => {});
      }
    });
    const code = await rejectionCodeWithin(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 500,
        bodyCapBytes: 16,
        onContact,
        fetchImpl: vi.fn(async (_input, init) => {
          init?.signal?.addEventListener('abort', () => {
            abortCount += 1;
          });
          return new Response(oversized, {
            status: 200,
            headers: { 'content-length': '17' }
          });
        })
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_BODY_TOO_LARGE');
    expect(abortCount).toBe(1);
    expect(cancelCount).toBe(1);
    expect(onContact).not.toHaveBeenCalled();
  });

  it('preserves unexpected status while aborting and absorbing synchronous cancellation failure', async () => {
    const onContact = vi.fn();
    let abortCount = 0;
    let cancelCount = 0;
    const code = await rejectionCodeWithin(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 500,
        onContact,
        fetchImpl: vi.fn(async (_input, init) => {
          init?.signal?.addEventListener('abort', () => {
            abortCount += 1;
          });
          return {
            status: 302,
            headers: new Headers(),
            body: {
              cancel() {
                cancelCount += 1;
                throw new Error('fixture synchronous cancellation failure');
              }
            }
          } as unknown as Response;
        })
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_STATUS_MISMATCH');
    expect(abortCount).toBe(1);
    expect(cancelCount).toBe(1);
    expect(onContact).not.toHaveBeenCalled();
  });

  it('absorbs a late response cancellation rejection after declared oversize', async () => {
    const onContact = vi.fn();
    const unhandled: unknown[] = [];
    let abortCount = 0;
    let cancelCount = 0;
    const observeUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', observeUnhandled);
    try {
      const code = await rejectionCodeWithin(
        capturePublicContract({
          baseUrl: 'http://127.0.0.1:3101',
          timeoutMs: 500,
          bodyCapBytes: 16,
          onContact,
          fetchImpl: vi.fn(async (_input, init) => {
            init?.signal?.addEventListener('abort', () => {
              abortCount += 1;
            });
            return {
              status: 200,
              headers: new Headers({ 'content-length': '17' }),
              body: {
                cancel: () => {
                  cancelCount += 1;
                  return new Promise<void>((_resolve, reject) => {
                    setTimeout(() => reject(new Error('fixture late cancellation failure')), 10);
                  });
                }
              }
            } as unknown as Response;
          })
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(code).toBe('PUBLIC_CONTRACT_BODY_TOO_LARGE');
      expect(abortCount).toBe(1);
      expect(cancelCount).toBe(1);
      expect(unhandled).toEqual([]);
      expect(onContact).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', observeUnhandled);
    }
  });

  it('aborts and absorbs synchronous cancellation failure after an immediate reader rejection', async () => {
    const onContact = vi.fn();
    let abortCount = 0;
    let cancelCount = 0;
    const code = await rejectionCodeWithin(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 500,
        onContact,
        fetchImpl: vi.fn(async (_input, init) => {
          init?.signal?.addEventListener('abort', () => {
            abortCount += 1;
          });
          return {
            status: 200,
            headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
            body: {
              getReader: () => ({
                read: () => Promise.reject(new Error('fixture immediate reader failure')),
                cancel: () => {
                  cancelCount += 1;
                  throw new Error('fixture synchronous cancellation failure');
                },
                releaseLock: () => {}
              })
            }
          } as unknown as Response;
        })
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_CONTACT_FAILED');
    expect(abortCount).toBe(1);
    expect(cancelCount).toBe(1);
    expect(onContact).not.toHaveBeenCalled();
  });

  it('absorbs a late cancellation rejection after an immediate reader rejection', async () => {
    const onContact = vi.fn();
    const unhandled: unknown[] = [];
    let abortCount = 0;
    let cancelCount = 0;
    const observeUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', observeUnhandled);
    try {
      const code = await rejectionCodeWithin(
        capturePublicContract({
          baseUrl: 'http://127.0.0.1:3101',
          timeoutMs: 500,
          onContact,
          fetchImpl: vi.fn(async (_input, init) => {
            init?.signal?.addEventListener('abort', () => {
              abortCount += 1;
            });
            return {
              status: 200,
              headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
              body: {
                getReader: () => ({
                  read: () => Promise.reject(new Error('fixture immediate reader failure')),
                  cancel: () => {
                    cancelCount += 1;
                    return new Promise<void>((_resolve, reject) => {
                      setTimeout(() => reject(new Error('fixture late cancellation failure')), 10);
                    });
                  },
                  releaseLock: () => {}
                })
              }
            } as unknown as Response;
          })
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(code).toBe('PUBLIC_CONTRACT_CONTACT_FAILED');
      expect(abortCount).toBe(1);
      expect(cancelCount).toBe(1);
      expect(unhandled).toEqual([]);
      expect(onContact).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', observeUnhandled);
    }
  });

  it('non-blockingly cancels when AbortSignal makes a pending reader reject', async () => {
    const onContact = vi.fn();
    let abortCount = 0;
    let cancelCount = 0;
    const code = await rejectionCodeWithin(
      capturePublicContract({
        baseUrl: 'http://127.0.0.1:3101',
        timeoutMs: 100,
        onContact,
        fetchImpl: vi.fn(async (_input, init) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => {
            abortCount += 1;
          });
          return {
            status: 200,
            headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
            body: {
              getReader: () => ({
                read: () =>
                  new Promise<never>((_resolve, reject) => {
                    signal?.addEventListener(
                      'abort',
                      () => reject(new Error('fixture AbortSignal reader failure')),
                      { once: true }
                    );
                  }),
                cancel: () => {
                  cancelCount += 1;
                  return new Promise<void>(() => {});
                },
                releaseLock: () => {}
              })
            }
          } as unknown as Response;
        })
      })
    );

    expect(code).toBe('PUBLIC_CONTRACT_CONTACT_TIMEOUT');
    expect(abortCount).toBe(1);
    expect(cancelCount).toBe(1);
    expect(onContact).not.toHaveBeenCalled();
  });
});
