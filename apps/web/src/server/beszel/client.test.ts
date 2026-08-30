import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { BeszelCollectorConfig } from '../config.js';
import { BeszelClientError, createBeszelClient } from './client.js';

const config: Extract<BeszelCollectorConfig, { enabled: true }> = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:8090',
  username: 'ops-telemetry@thienuy.invalid',
  passwordFile: '/tmp/beszel-fixture-password',
  systemId: 'abc123def456ghi',
  timeoutMs: 1000
};

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
type Call = { url: string; init: RequestInit };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeFetch(options: { info401?: boolean; second401?: boolean } = {}) {
  const calls: Call[] = [];
  let info401 = options.info401 ?? false;
  const second401 = options.second401 ?? false;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path.endsWith('/auth-with-password')) return response(fixture('auth'));
    if (path === '/api/beszel/info' && info401) {
      info401 = false;
      return response({ error: 'expired' }, 401);
    }
    if (path === '/api/beszel/info' && second401) return response({ error: 'expired-again' }, 401);
    if (path === '/api/beszel/info') return response(fixture('info'));
    if (path.includes('/systems/records/')) return response(fixture('system'));
    if (path.endsWith('/system_stats/records')) return response(fixture('system-stats'));
    if (path.endsWith('/systemd_services/records')) return response(fixture('systemd-services'));
    return response({ error: 'unexpected' }, 404);
  });
  return { calls, fetchImpl };
}

describe('Beszel fixed endpoint client', () => {
  it('authenticates once, caches the token and calls only the pinned endpoints', async () => {
    const fake = makeFetch();
    const client = createBeszelClient(config, {
      fetchImpl: fake.fetchImpl as typeof fetch,
      readPassword: () => 'fixture-password\n'
    });

    await client.readSnapshot();
    await client.readSnapshot();

    expect(fake.calls.map(({ url }) => new URL(url).pathname)).toEqual([
      '/api/collections/users/auth-with-password',
      '/api/beszel/info',
      '/api/collections/systems/records/abc123def456ghi',
      '/api/collections/system_stats/records',
      '/api/collections/systemd_services/records',
      '/api/beszel/info',
      '/api/collections/systems/records/abc123def456ghi',
      '/api/collections/system_stats/records',
      '/api/collections/systemd_services/records'
    ]);
    expect(JSON.parse(String(fake.calls[0].init.body))).toEqual({
      identity: config.username,
      password: 'fixture-password'
    });
    expect(
      fake.calls
        .slice(1)
        .every(
          ({ init }) =>
            (init.headers as Record<string, string>).Authorization === 'fixture-token-not-a-secret'
        )
    ).toBe(true);
    const statsUrl = new URL(fake.calls[3].url);
    expect(statsUrl.searchParams.get('fields')).toBe('created,stats');
    expect(statsUrl.searchParams.get('perPage')).toBe('1');
    expect(statsUrl.searchParams.get('filter')).toBe('system="abc123def456ghi" && type="1m"');
    const servicesUrl = new URL(fake.calls[4].url);
    expect(servicesUrl.searchParams.get('fields')).toBe('name,state,sub,cpu,memory,updated');
  });

  it('reauthenticates once after 401 and rejects a second 401', async () => {
    const first = makeFetch({ info401: true });
    const client = createBeszelClient(config, {
      fetchImpl: first.fetchImpl as typeof fetch,
      readPassword: () => 'fixture-password'
    });
    await client.readSnapshot();
    expect(
      first.calls.filter(({ url }) => new URL(url).pathname.endsWith('/auth-with-password'))
    ).toHaveLength(2);

    const second = makeFetch({ info401: true, second401: true });
    const failedClient = createBeszelClient(config, {
      fetchImpl: second.fetchImpl as typeof fetch,
      readPassword: () => 'fixture-password'
    });
    await expect(failedClient.readSnapshot()).rejects.toMatchObject({ code: 'beszel_auth_failed' });
    expect(
      second.calls.filter(({ url }) => new URL(url).pathname.endsWith('/auth-with-password'))
    ).toHaveLength(2);
  });

  it('fails closed for identity mismatch and truncated service pages', async () => {
    const mismatch = makeFetch();
    mismatch.fetchImpl.mockImplementation(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        mismatch.calls.push({ url: String(input), init });
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/auth-with-password'))
          return response({
            ...(fixture('auth') as object),
            record: {
              ...(fixture('auth') as { record: object }).record,
              email: 'other@example.invalid'
            }
          });
        return response(
          fixture(
            path === '/api/beszel/info'
              ? 'info'
              : path.includes('/systems/')
                ? 'system'
                : path.endsWith('/system_stats/records')
                  ? 'system-stats'
                  : 'systemd-services'
          )
        );
      }
    );
    await expect(
      createBeszelClient(config, {
        fetchImpl: mismatch.fetchImpl as typeof fetch,
        readPassword: () => 'fixture-password'
      }).readSnapshot()
    ).rejects.toMatchObject({ code: 'beszel_contract_invalid' });

    const truncated = makeFetch();
    truncated.fetchImpl.mockImplementation(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        truncated.calls.push({ url: String(input), init });
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/auth-with-password')) return response(fixture('auth'));
        if (path.endsWith('/systemd_services/records'))
          return response({ ...(fixture('systemd-services') as object), totalItems: 201 });
        return response(
          fixture(
            path === '/api/beszel/info'
              ? 'info'
              : path.includes('/systems/')
                ? 'system'
                : 'system-stats'
          )
        );
      }
    );
    await expect(
      createBeszelClient(config, {
        fetchImpl: truncated.fetchImpl as typeof fetch,
        readPassword: () => 'fixture-password'
      }).readSnapshot()
    ).rejects.toMatchObject({ code: 'beszel_contract_invalid' });
  });

  it('maps timeout, network, HTTP, JSON, schema and empty-stat failures to bounded codes', async () => {
    const cases: Array<[string, (url: string, init: RequestInit) => Promise<Response>, string]> = [
      [
        'network',
        async () => {
          throw new TypeError('password=fixture-password token=fixture-token');
        },
        'beszel_unreachable'
      ],
      ['http', async () => response({ body: 'secret response' }, 503), 'beszel_http_error'],
      ['json', async () => new Response('{not-json', { status: 200 }), 'beszel_invalid_json'],
      ['schema', async () => response({ v: '0.19.0' }), 'beszel_contract_invalid'],
      [
        'empty',
        async (url) =>
          url.includes('/system_stats/')
            ? response({ page: 1, perPage: 1, totalPages: 1, totalItems: 0, items: [] })
            : response(
                fixture(
                  new URL(url).pathname === '/api/beszel/info'
                    ? 'info'
                    : new URL(url).pathname.includes('/systems/')
                      ? 'system'
                      : new URL(url).pathname.includes('/systemd_services/')
                        ? 'systemd-services'
                        : 'auth'
                )
              ),
        'beszel_no_stats'
      ]
    ];
    for (const [, implementation, expected] of cases) {
      const fetchImpl = vi.fn(implementation);
      const error = await createBeszelClient(config, {
        fetchImpl: fetchImpl as typeof fetch,
        readPassword: () => 'fixture-password'
      })
        .readSnapshot()
        .catch((value: unknown) => value as BeszelClientError);
      expect(error).toMatchObject({ code: expected });
      expect(String(error)).not.toMatch(/fixture-password|fixture-token|secret response/i);
    }
  });

  it('uses one deadline for the complete snapshot', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('timed out', 'AbortError')),
            { once: true }
          );
        })
    );
    const error = await createBeszelClient(config, {
      fetchImpl: fetchImpl as typeof fetch,
      readPassword: () => 'fixture-password'
    })
      .readSnapshot()
      .catch((value: unknown) => value as BeszelClientError);
    expect((error as BeszelClientError).code).toBe('beszel_timeout');
  });
});
