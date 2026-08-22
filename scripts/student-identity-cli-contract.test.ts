import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPTS = [
  'normalize-student-profiles.ts',
  'set-student-identity-maintenance.ts',
  'set-canonical-student-read-mode.ts',
  'rebuild-student-identity-projections.ts',
  'check-student-identity-health.ts',
  'run-student-identity-smoke.ts',
];

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

describe('CLI contracts', () => {
  for (const script of SCRIPTS) {
    const scriptPath = path.join(__dirname, script);
    if (!fs.existsSync(scriptPath)) {
      console.warn(`Script ${script} does not exist, skipping.`);
      continue;
    }
    
    it(`exits 0 for --help on ${script}`, () => {
      try {
        execFileSync(npx, ['tsx', `scripts/${script}`, '--help'], { stdio: 'pipe', shell: true });
      } catch (err: any) {
        expect.fail(`Expected exit code 0, got ${err.status}. Stderr: ${err.stderr?.toString()}`);
      }
    }, 60000);

    it(`exits 2 for --definitely-invalid on ${script}`, () => {
      try {
        execFileSync(npx, ['tsx', `scripts/${script}`, '--definitely-invalid'], { stdio: 'pipe', shell: true });
        expect.fail('Expected error but succeeded');
      } catch (err: any) {
        expect(err.status, `Stderr: ${err.stderr?.toString()}`).toBe(2);
      }
    }, 60000);
  }
});
