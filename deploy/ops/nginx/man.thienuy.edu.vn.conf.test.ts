import { execFileSync, spawn } from 'node:child_process';
import { createServer, get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const configPath = fileURLToPath(new URL('./man.thienuy.edu.vn-api.conf', import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function listenPlane(port: number, plane: 'api' | 'web') {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        plane,
        path: request.url,
        forwardedProto: request.headers['x-forwarded-proto'],
        requestId: request.headers['x-request-id']
      })
    );
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function requestThroughTlsNginx(port: number, path: string) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = getHttps(
      {
        host: '127.0.0.1',
        port,
        path,
        servername: 'man.thienuy.edu.vn',
        rejectUnauthorized: false
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() });
        });
      }
    );
    request.on('error', reject);
    request.setTimeout(200, () => request.destroy(new Error('Nginx did not accept a TLS request')));
  });
}

function requestThroughHttpNginx(port: number, path: string, host: string) {
  return new Promise<{ status: number; location: string | undefined }>((resolve, reject) => {
    const request = getHttp(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { Host: host }
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, location: response.headers.location });
        });
      }
    );
    request.on('error', reject);
    request.setTimeout(200, () =>
      request.destroy(new Error('Nginx did not accept an HTTP request'))
    );
  });
}

describe('man.thienuy.edu.vn canonical dual-plane vhost', () => {
  it('declares disjoint route ownership and no certificate placeholder', () => {
    const config = readFileSync(configPath, 'utf8');

    expect(config).toMatch(/location = \/healthz[\s\S]*127\.0\.0\.1:3100/);
    expect(config).toMatch(/location (?:\^~ )?\/api\/v1\/[\s\S]*127\.0\.0\.1:3100/);
    expect(config).toMatch(/location = \/api\/zalo-bot\/webhook[\s\S]*127\.0\.0\.1:3101/);
    expect(config).toMatch(/location = \/api\/session[\s\S]*return 410/);
    expect(config).not.toContain('location /api/ {');
    expect(config).toMatch(/location \/[\s\S]*127\.0\.0\.1:3101/);
    expect(config).not.toContain('REPLACE_WITH_CERT_NAME');
    expect(config).not.toMatch(/^\s*ssl_(?:protocols|session_timeout)\b/mu);
  });

  it('forwards each route namespace to only its designated loopback plane and canonicalizes HTTP redirects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-nginx-vhost-'));
    const httpPort = await freePort();
    const httpsPort = await freePort();
    const apiPort = await freePort();
    const webPort = await freePort();
    const api = await listenPlane(apiPort, 'api');
    const web = await listenPlane(webPort, 'web');
    const source = readFileSync(configPath, 'utf8')
      .replace(/listen 80;/u, `listen 127.0.0.1:${httpPort};`)
      .replace(/\s*listen \[::\]:80;\n/u, '\n')
      .replace(/listen 443 ssl http2;/u, `listen 127.0.0.1:${httpsPort} ssl;`)
      .replace(/\s*listen \[::\]:443 ssl http2;\n/u, '\n')
      .replace(/ssl_certificate .+;/u, `ssl_certificate ${join(directory, 'cert.pem')};`)
      .replace(/ssl_certificate_key .+;/u, `ssl_certificate_key ${join(directory, 'key.pem')};`)
      .replace(/^\s*include \/etc\/letsencrypt\/options-ssl-nginx\.conf;\n/mu, '')
      .replace(/^\s*ssl_dhparam \/etc\/letsencrypt\/ssl-dhparams\.pem;\n/mu, '')
      .replaceAll('127.0.0.1:3100', `127.0.0.1:${apiPort}`)
      .replaceAll('127.0.0.1:3101', `127.0.0.1:${webPort}`);
    writeFileSync(
      join(directory, 'nginx.conf'),
      `pid ${join(directory, 'nginx.pid')};\nerror_log ${join(directory, 'error.log')} notice;\nevents {}\nhttp {\naccess_log ${join(directory, 'access.log')};\n${source}\n}\n`
    );
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-nodes',
        '-newkey',
        'rsa:2048',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-subj',
        '/CN=man.thienuy.edu.vn',
        '-days',
        '1'
      ],
      { stdio: 'ignore' }
    );

    const nginx = spawn('nginx', [
      '-p',
      directory,
      '-c',
      join(directory, 'nginx.conf'),
      '-g',
      'daemon off;'
    ]);
    let nginxError = '';
    nginx.stderr.on('data', (chunk: Buffer) => {
      nginxError += chunk.toString();
    });
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (nginx.exitCode !== null) throw new Error(`Nginx exited: ${nginxError}`);
        try {
          await requestThroughTlsNginx(httpsPort, '/healthz');
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }

      for (const [path, plane] of [
        ['/healthz', 'api'],
        ['/api/v1', 'api'],
        ['/api/v1/auth/session', 'api'],
        ['/api/zalo-bot/webhook', 'web'],
        ['/', 'web'],
        ['/assets/app.js', 'web']
      ] as const) {
        const response = await requestThroughTlsNginx(httpsPort, path);
        expect(response.status, path).toBe(200);
        const body = JSON.parse(response.text) as Record<string, unknown>;
        expect(body).toMatchObject({ plane, path, forwardedProto: 'https' });
        expect(body.requestId).toEqual(expect.any(String));
      }

      for (const path of ['/api/session', '/api/overview', '/api/unknown']) {
        expect((await requestThroughTlsNginx(httpsPort, path)).status).toBe(410);
      }

      const redirect = await requestThroughHttpNginx(
        httpPort,
        '/api/v1?trace=1',
        'attacker.invalid'
      );
      expect(redirect).toEqual({
        status: 308,
        location: 'https://man.thienuy.edu.vn/api/v1?trace=1'
      });
    } finally {
      if (nginx.exitCode === null) {
        nginx.kill();
        await once(nginx, 'exit');
      }
      await Promise.all([
        new Promise<void>((resolve, reject) =>
          api.close((error) => (error ? reject(error) : resolve()))
        ),
        new Promise<void>((resolve, reject) =>
          web.close((error) => (error ? reject(error) : resolve()))
        )
      ]);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
