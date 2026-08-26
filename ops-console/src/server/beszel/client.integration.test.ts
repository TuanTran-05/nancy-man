import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BeszelCollectorConfig } from '../config.js';
import { createBeszelClient } from './client.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const config: Extract<BeszelCollectorConfig, { enabled: true }> = { enabled: true, baseUrl: 'http://127.0.0.1:8090', username: 'ops-telemetry@thienuy.invalid', passwordFile: '/ignored-by-test', systemId: 'abc123def456ghi', timeoutMs: 2000 };

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

describe('Beszel local fake-server integration', () => {
  it('round-trips the exact query and one 401 retry without Internet', async () => {
    const requests: Array<{ method: string; path: string; authorization?: string; body: string }> = [];
    let forceUnauthorized = true;
    const server = createServer(async (request, response) => {
      const body = await readBody(request);
      requests.push({ method: request.method ?? '', path: request.url ?? '', authorization: request.headers.authorization, body });
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (path.endsWith('/auth-with-password')) return send(response, fixture('auth'));
      if (path === '/api/beszel/info' && forceUnauthorized) { forceUnauthorized = false; return send(response, { error: 'expired' }, 401); }
      if (path === '/api/beszel/info') return send(response, fixture('info'));
      if (path.includes('/systems/records/')) return send(response, fixture('system'));
      if (path.endsWith('/system_stats/records')) return send(response, fixture('system-stats'));
      if (path.endsWith('/systemd_services/records')) return send(response, fixture('systemd-services'));
      return send(response, { error: 'not-found' }, 404);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fake server did not bind');
    const origin = `http://127.0.0.1:${address.port}`;
    const fetchImpl: typeof fetch = (input, init) => {
      const source = new URL(String(input));
      return fetch(`${origin}${source.pathname}${source.search}`, init);
    };
    try {
      const snapshot = await createBeszelClient(config, { fetchImpl, readPassword: () => 'fixture-password' }).readSnapshot();
      expect(snapshot.hub.v).toBe('0.18.8');
      expect(requests.filter(({ path }) => path.endsWith('/auth-with-password'))).toHaveLength(2);
      expect(requests.every(({ path, authorization }) => path.endsWith('/auth-with-password') || authorization === 'fixture-token-not-a-secret')).toBe(true);
      const stats = requests.find(({ path }) => path.includes('/system_stats/records'))?.path ?? '';
      expect(new URL(stats, origin).searchParams.get('fields')).toBe('created,stats');
      expect(new URL(stats, origin).searchParams.get('filter')).toBe('system="abc123def456ghi" && type="1m"');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
