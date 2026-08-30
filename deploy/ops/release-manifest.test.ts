import { execFileSync } from 'node:child_process';
import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const manifestTool = fileURLToPath(new URL('./release-manifest.mjs', import.meta.url));

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'edutrack-ops-release-test-manifest-'));
  mkdirSync(join(root, 'apps', 'api', 'dist'), { recursive: true });
  writeFileSync(join(root, 'apps', 'api', 'dist', 'main.js'), 'console.log("safe");\n');
  writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
  return root;
}

function run(...args: string[]): string {
  return execFileSync(process.execPath, [manifestTool, ...args], { encoding: 'utf8' });
}

describe('immutable Ops release manifest', () => {
  it('generates deterministic entries and verifies them while excluding only the manifest and release marker', () => {
    const root = fixture();

    const first = run('generate', root);
    const second = run('generate', root);

    expect(first).toBe(second);
    const manifest = JSON.parse(readFileSync(join(root, '.release-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      selfExcluded: ['.release-manifest.json', '.release-source.json']
    });
    expect(manifest.entries.map((entry: { path: string }) => entry.path)).toEqual([
      'apps/api/dist/main.js',
      'package.json'
    ]);
    expect(run('verify', root)).toMatch(/RELEASE_MANIFEST_PASS/u);
  });

  it('rejects corruption, symlinks, hardlinks, traversal paths, and secret or shared-data classes', () => {
    const root = fixture();
    run('generate', root);
    writeFileSync(join(root, 'apps', 'api', 'dist', 'main.js'), 'tampered\n');
    expect(() => run('verify', root)).toThrow(/RELEASE_MANIFEST_DIGEST_MISMATCH/u);

    const unsafe = fixture();
    mkdirSync(join(unsafe, 'shared'), { recursive: true });
    writeFileSync(join(unsafe, 'shared', 'ops.sqlite'), 'not a release asset');
    expect(() => run('generate', unsafe)).toThrow(/RELEASE_MANIFEST_PATH_FORBIDDEN/u);

    const linked = fixture();
    symlinkSync('/etc/passwd', join(linked, 'apps', 'api', 'dist', 'outside'));
    expect(() => run('generate', linked)).toThrow(/RELEASE_MANIFEST_SYMLINK/u);

    const hardlinked = fixture();
    linkSync(
      join(hardlinked, 'apps', 'api', 'dist', 'main.js'),
      join(hardlinked, 'apps', 'api', 'dist', 'second-name.js')
    );
    expect(() => run('generate', hardlinked)).toThrow(/RELEASE_MANIFEST_HARDLINK/u);
  });
});
