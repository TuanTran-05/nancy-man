import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The runbook is executable instructions for somebody under time pressure.
 *
 * A command in it that does not exist is discovered at 2am, with writes
 * blocked and a sixty-minute limit running. So the parity is checked here
 * rather than trusted: every `npm run` in the runbook must be a real script,
 * and every script the cutover depends on must appear in the runbook.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const runbook = readFileSync(
  path.join(ROOT, 'docs/runbooks/canonical-student-profile-cutover.md'),
  'utf8'
);
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

function scriptsReferencedIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/npm(?:\.cmd)? run ([a-z0-9:_-]+)/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

describe('runbook command parity', () => {
  it('references only scripts that exist', () => {
    const missing = scriptsReferencedIn(runbook).filter(
      (script) => !packageJson.scripts[script]
    );

    expect(missing).toEqual([]);
  });

  it('documents every command the cutover and retirement depend on', () => {
    // A script nobody documented is a step somebody skips.
    const required = [
      'maintenance:student-identity',
      'transition:canonical-student-read-mode',
      'repair:student-identity-projections',
      'smoke:student-identity',
      'verify:student-identity-cutover',
      'audit:student-profile-retirement',
      'audit:student-profile-retirement:final',
      'retire:student-profile-tombstones',
      'verify:student-profile-retirement',
      'check:student-identity-architecture',
    ];
    const referenced = new Set(scriptsReferencedIn(runbook));
    const undocumented = required.filter((script) => !referenced.has(script));

    expect(undocumented).toEqual([]);
  });

  it('states the abort, rollback, and stale-lease refusals explicitly', () => {
    // These three are where an operator most needs the answer to be written
    // down rather than reasoned out under pressure.
    expect(runbook).toContain('aborted-before-apply');
    expect(runbook).toContain('verified-rollback');
    expect(runbook).toContain('A stale lease is **not** something to clear');
  });

  it('requires no manual DocumentStore edit anywhere', () => {
    // Every state change goes through a guarded command. A runbook that says
    // "set this field" is a runbook that can reopen writes underneath a
    // running merge.
    for (const phrase of ['edit the document', 'set the field manually', 'in the Firebase console']) {
      expect(runbook.toLowerCase()).not.toContain(phrase);
    }
  });
});
