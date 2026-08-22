// Generate native VPS session tokens for authenticated k6 scenarios.
// This script only logs in existing test accounts; it never creates users.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSafeLoadtestEnvironment } from './productionGuard.js';

assertSafeLoadtestEnvironment();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = requiredEnv('BASE_URL').replace(/\/$/, '');

async function login(role: 'admin' | 'teacher'): Promise<string> {
  const prefix = `LOADTEST_${role.toUpperCase()}`;
  const response = await fetch(`${baseUrl}/api/v1/auth/session-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      email: requiredEnv(`${prefix}_EMAIL`),
      password: requiredEnv(`${prefix}_PASSWORD`),
      turnstileToken: requiredEnv(`${prefix}_TURNSTILE_TOKEN`),
    }),
  });
  if (!response.ok) {
    throw new Error(`${role} session login failed (${response.status}): ${await response.text()}`);
  }
  const cookie = response.headers.getSetCookie?.().find((value) =>
    value.startsWith('edutrack_session=')
  ) || response.headers.get('set-cookie');
  const token = /(?:^|;\s*)edutrack_session=([^;]+)/.exec(cookie || '')?.[1];
  if (!token) throw new Error(`${role} login did not return an edutrack_session cookie`);
  return decodeURIComponent(token);
}

async function main() {
  const [admin, teacher] = await Promise.all([login('admin'), login('teacher')]);
  const outputPath = join(process.cwd(), 'loadtests', 'data', 'tokens.json');
  writeFileSync(
    outputPath,
    JSON.stringify({ admin, teacher, student: '', generatedAt: new Date().toISOString() }, null, 2)
  );
  console.log(`Native session tokens saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error('Token generation failed:', error);
  process.exitCode = 1;
});
