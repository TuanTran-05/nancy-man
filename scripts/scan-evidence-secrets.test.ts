import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SENSITIVE_PATTERNS = [
  /postgres(?:ql)?:\/\/[a-zA-Z0-9_]+:[^@\s/]+@/i, // DSN with username:password
  /BEGIN\s+PRIVATE\s+KEY/i,
  /BEGIN\s+RSA\s+PRIVATE\s+KEY/i,
  /password\s*=\s*['"][a-zA-Z0-9_!@#$%^&*()]{8,}['"]/i
];

const ALLOWED_PLACEHOLDERS = [
  'password',
  'secret',
  '<password>',
  ':ops_browser_password',
  ':ops_read_password',
  ':ops_cancel_password'
];

describe('scan evidence and deploy assets for secrets', () => {
  it('ensures deploy/postgres SQL files do not contain hardcoded passwords', async () => {
    const dir = new URL('../deploy/postgres', import.meta.url).pathname;
    const files = await readdir(dir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql'));

    for (const sqlFile of sqlFiles) {
      const content = await readFile(join(dir, sqlFile), 'utf8');
      for (const pattern of SENSITIVE_PATTERNS) {
        const match = pattern.exec(content);
        if (match) {
          const matchedText = match[0].toLowerCase();
          const isPlaceholder = ALLOWED_PLACEHOLDERS.some((p) => matchedText.includes(p));
          expect(isPlaceholder, `Found potential secret in ${sqlFile}: ${match[0]}`).toBe(true);
        }
      }
    }
  });

  it('ensures runbooks do not contain live connection strings or passwords', async () => {
    const runbooksDir = new URL('../docs/runbooks', import.meta.url).pathname;
    const files = ['database-explorer-rollout.md', 'sql-role-rotation.md'];

    for (const file of files) {
      const content = await readFile(join(runbooksDir, file), 'utf8');
      for (const pattern of SENSITIVE_PATTERNS) {
        const match = pattern.exec(content);
        if (match) {
          const matchedText = match[0].toLowerCase();
          const isPlaceholder = ALLOWED_PLACEHOLDERS.some((p) => matchedText.includes(p));
          expect(isPlaceholder, `Found potential secret in ${file}: ${match[0]}`).toBe(true);
        }
      }
    }
  });

  it('ensures deploy/postgres shell scripts do not leak passwords via echo or printf', async () => {
    const applyScript = await readFile(
      new URL('../deploy/postgres/apply-role-grants.sh', import.meta.url).pathname,
      'utf8'
    );

    expect(applyScript).not.toMatch(/(?:echo|printf).*password/i);
    expect(applyScript).toContain('read_generated_password');
    expect(applyScript).toContain(
      'tr -d \'\\r\\n\' < "$read_password_file" | node "$SCRAM_VERIFIER_PATH"'
    );
    expect(applyScript).toContain('mode must be 0600');
  });
});
