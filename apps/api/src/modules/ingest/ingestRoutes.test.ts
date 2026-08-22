import express from 'express';
import { describe, expect, it } from 'vitest';

import { createIngestRouter } from './ingestRoutes.js';

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
  options: Parameters<typeof createIngestRouter>[0]
): Promise<void> {
  const app = express();
  app.use('/api/v1/ingest', createIngestRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP test server');
  }

  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

describe('ingest routes', () => {
  it('forwards an allowed browser request and only reflects configured CORS origins', async () => {
    const seen: unknown[] = [];
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/ingest/browser`, {
          method: 'POST',
          headers: {
            Origin: 'https://thienuy.edu.vn',
            'Content-Type': 'application/json',
            'X-Ops-Project-Key': 'public-browser-key'
          },
          body: JSON.stringify({ schemaVersion: 1 })
        });

        expect(response.status).toBe(202);
        expect(response.headers.get('access-control-allow-origin')).toBe('https://thienuy.edu.vn');
        await expect(response.json()).resolves.toEqual({
          accepted: true,
          duplicate: false,
          eventId: 'EVT_01K3ZABCDEF0123456789ABCDE'
        });
      },
      {
        browser: {
          ingest: async (request) => {
            seen.push(request);
            return {
              status: 202 as const,
              accepted: true as const,
              duplicate: false,
              eventId: 'EVT_01K3ZABCDEF0123456789ABCDE'
            };
          }
        },
        server: {
          ingest: async () => ({ status: 401 as const, accepted: false as const, code: 'UNUSED' }),
          ingestBatch: async () => ({ status: 401 as const, accepted: false as const, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      }
    );

    expect(seen).toMatchObject([
      {
        origin: 'https://thienuy.edu.vn',
        projectKey: 'public-browser-key',
        rawBody: '{"schemaVersion":1}'
      }
    ]);
  });

  it('does not grant CORS preflight access to an unconfigured origin', async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/ingest/browser`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://attacker.example',
            'Access-Control-Request-Method': 'POST'
          }
        });

        expect(response.status).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
      },
      {
        browser: { ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }) },
        server: {
          ingest: async () => ({ status: 401, accepted: false, code: 'UNUSED' }),
          ingestBatch: async () => ({ status: 401, accepted: false, code: 'UNUSED' })
        },
        browserCorsOrigins: ['https://thienuy.edu.vn']
      }
    );
  });
});
