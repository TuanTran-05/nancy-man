import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

const servers: import('node:http').Server[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});
describe('Express VPS adapter', () => {
  it('returns JSON 404 for an unknown API instead of the SPA', async () => {
    const server = createApp({ serveFrontend: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/not-real/action`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'API route not found' });
  });

  it('rejects a cross-site API mutation before route dispatch', async () => {
    vi.stubEnv('APP_URL', 'https://vps.thienuy.edu.vn');
    const server = createApp({ serveFrontend: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/not-real/action`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example.test',
        'Sec-Fetch-Site': 'cross-site',
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Cross-site request rejected',
    });
  });

  it('allows a configured same-origin mutation to reach route dispatch', async () => {
    vi.stubEnv('APP_URL', 'https://vps.thienuy.edu.vn');
    const server = createApp({ serveFrontend: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/not-real/action`, {
      method: 'POST',
      headers: {
        Origin: 'https://vps.thienuy.edu.vn',
        'Sec-Fetch-Site': 'same-origin',
      },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'API route not found' });
  });

  it('blocks every API mutation while the global cutover freeze is enabled', async () => {
    vi.stubEnv('GLOBAL_WRITE_FREEZE', 'true');
    const server = createApp({ serveFrontend: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/not-real/action`, {
      method: 'POST',
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('300');
    expect(await response.json()).toEqual({
      success: false,
      error: 'System maintenance is in progress',
      code: 'GLOBAL_WRITE_FREEZE',
    });
  });

  it('keeps API reads available during the global cutover freeze', async () => {
    vi.stubEnv('GLOBAL_WRITE_FREEZE', 'true');
    const server = createApp({ serveFrontend: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/not-real/action`);

    expect(response.status).toBe(404);
  });

  it('blocks legacy GET cron endpoints that mutate data during the global freeze', async () => {
    vi.stubEnv('GLOBAL_WRITE_FREEZE', 'true');
    const server = createApp({ serveFrontend: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/audit/daily-maintenance`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GLOBAL_WRITE_FREEZE' });
  });

  it('does not consume multipart bodies before dispatch', async () => {
    const server = createApp({ serveFrontend: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const form = new FormData();
    form.set('file', new Blob(['not-a-valid-workbook']), 'students.xlsx');

    const response = await fetch(`http://127.0.0.1:${port}/api/students/import`, {
      method: 'POST',
      body: form,
    });

    // Handler den duoc lop env/auth. Tuy CI co bien moi truong backend hay khong, 404
    // nghia la Express da lam mat mount path /api; 400 nghia la body parser da
    // an stream truoc formidable.
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
