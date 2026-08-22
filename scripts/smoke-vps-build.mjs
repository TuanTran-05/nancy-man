import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 31337;
const child = spawn(process.execPath, ['dist-server/index.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    APP_URL: 'http://127.0.0.1:31337',
    PUBLIC_BASE_URL: 'http://127.0.0.1:31337',
    INTERNAL_API_BASE_URL: 'http://127.0.0.1:31337',
    CRON_SECRET: 'build-smoke-only',
    SESSION_SECRET: 'build-smoke-session-secret-32-characters',
    OTP_PEPPER: 'build-smoke-only',
    LOOKUP_CHALLENGE_SECRET: 'build-smoke-only',
    TURNSTILE_SECRET_KEY: 'build-smoke-only',
    VITE_TURNSTILE_SITE_KEY: 'build-smoke-only',
    DATABASE_URL: 'postgres://edutrack:build-smoke-only@127.0.0.1:5432/edutrack',
    STORAGE_BACKEND: 'local',
    STORAGE_LOCAL_ROOT: '/tmp/edutrack-build-smoke-uploads',
    STORAGE_SIGNING_SECRET: 'build-smoke-storage-secret-32-characters',
  },
});

let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

const deadline = Date.now() + 20_000;
while (!output.includes('[http] listening') && Date.now() < deadline) {
  if (child.exitCode !== null)
    throw new Error(`server exited early (${child.exitCode})\n${output}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!output.includes('[http] listening')) throw new Error(`server did not start\n${output}`);

try {
  const liveness = await fetch(`http://127.0.0.1:${port}/api/v1/liveness`);
  const livenessPayload = await liveness.json();
  if (!liveness.ok || livenessPayload.status !== 'ok') {
    throw new Error(
      `unexpected liveness response: ${liveness.status} ${JSON.stringify(livenessPayload)}`
    );
  }

  const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  const healthPayload = await health.json();
  const healthRouteWorked =
    (health.ok && healthPayload.status === 'ok' && healthPayload.db === 'connected') ||
    (health.status === 503 && healthPayload.status === 'degraded');
  // This build smoke intentionally has no PostgreSQL service. A
  // degraded response proves the route and readiness check execute; live DB
  // connectivity is covered by db:check and the deployment smoke on the VPS.
  if (!healthRouteWorked) {
    throw new Error(
      `unexpected health response: ${health.status} ${JSON.stringify(healthPayload)}`
    );
  }

  const api = await fetch(`http://127.0.0.1:${port}/api/not-real/action`);
  if (
    api.status !== 404 ||
    api.headers.get('content-type')?.includes('application/json') !== true
  ) {
    throw new Error(`unexpected API fallback: ${api.status} ${await api.text()}`);
  }

  const spa = await fetch(`http://127.0.0.1:${port}/deep/link`);
  const html = await spa.text();
  if (!spa.ok || !html.includes('<div id="root">')) {
    throw new Error(`unexpected SPA fallback: ${spa.status}`);
  }
  console.log('VPS build smoke passed: liveness/readiness, API 404 JSON, SPA fallback');
} finally {
  child.kill();
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
}
