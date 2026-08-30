import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const prepare = fileURLToPath(new URL('./prepare-release.sh', import.meta.url));
const activate = fileURLToPath(new URL('./activate-release.sh', import.meta.url));
const manifest = fileURLToPath(new URL('./release-manifest.mjs', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD^{tree}'], {
  encoding: 'utf8'
}).trim();

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'edutrack-ops-release-test-assets-'));
  mkdirSync(join(directory, 'releases'), { recursive: true });
  return directory;
}

function build(directory: string, sourceSha = sha): string {
  const output = join(directory, 'verified-build');
  for (const file of [
    'apps/api/dist/apps/api/src/runtime/main.js',
    'apps/notifier/dist/apps/notifier/src/runtime/main.js',
    'apps/processor/dist/apps/processor/src/runtime/main.js',
    'apps/sql-worker/dist/apps/sql-worker/src/index.js',
    'apps/web/dist/server/web-entry.js',
    'apps/web/dist/server/collector-entry.js',
    'apps/web/dist/server/failsafe-entry.js',
    'packages/telemetry-sdk/dist/index.js'
  ]) {
    mkdirSync(join(output, file, '..'), { recursive: true });
    writeFileSync(join(output, file), `// ${file}\n`);
  }
  for (const file of ['package.json', 'package-lock.json']) {
    mkdirSync(join(output, file, '..'), { recursive: true });
    writeFileSync(join(output, file), '{}\n');
  }
  for (const name of ['api', 'notifier', 'processor', 'sql-worker', 'web']) {
    mkdirSync(join(output, 'apps', name), { recursive: true });
    writeFileSync(join(output, 'apps', name, 'package.json'), '{}\n');
  }
  for (const name of ['contracts', 'db', 'security', 'telemetry-sdk']) {
    mkdirSync(join(output, 'packages', name), { recursive: true });
    writeFileSync(join(output, 'packages', name, 'package.json'), '{}\n');
  }
  mkdirSync(join(output, 'packages', 'db', 'migrations'), { recursive: true });
  writeFileSync(join(output, 'packages', 'db', 'migrations', '0001_fixture.sql'), 'select 1;\n');
  writeFileSync(
    join(output, '.edutrack-ops-build.json'),
    `${JSON.stringify({ gitSha: sourceSha, treeSha: tree })}\n`
  );
  return output;
}

function stub(directory: string, name: string, body: string): string {
  const path = join(directory, 'stubs', name);
  mkdirSync(join(directory, 'stubs'), { recursive: true });
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  execFileSync('chmod', ['0755', path]);
  return path;
}

function testEnvironment(directory: string, extra: Record<string, string> = {}) {
  return {
    ...process.env,
    EDUTRACK_OPS_RELEASE_TEST_MODE: '1',
    EDUTRACK_OPS_RELEASE_TEST_ROOT: directory,
    EDUTRACK_OPS_RELEASE_REPOSITORY: repo,
    ...extra
  };
}

function run(
  script: string,
  directory: string,
  args: string[],
  extra: Record<string, string> = {}
) {
  return execFileSync('bash', [script, ...args], {
    env: testEnvironment(directory, extra),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function prepareRelease(
  directory: string,
  buildDirectory = build(directory),
  sourceSha = sha
): string {
  return run(prepare, directory, [sourceSha, buildDirectory]);
}

describe('immutable Ops prepare and activate assets', () => {
  it('rejects invalid, unreachable, source-mismatched, unsafe, existing, and incomplete release inputs without mutating current', () => {
    const directory = root();
    const old = join(directory, 'releases', 'previous');
    mkdirSync(old);
    symlinkSync(old, join(directory, 'current'));
    const current = readlinkSync(join(directory, 'current'));
    const validBuild = build(directory);

    for (const [candidate, expected] of [
      ['short', 'RELEASE_SHA_INVALID'],
      ['0000000000000000000000000000000000000000', 'RELEASE_SHA_UNREACHABLE'],
      [sha, 'RELEASE_BUILD_SOURCE_MISMATCH']
    ] as const) {
      const buildDirectory = candidate === sha ? build(root(), `${'f'.repeat(40)}`) : validBuild;
      expect(() => run(prepare, directory, [candidate, buildDirectory])).toThrow(
        new RegExp(expected)
      );
      expect(readlinkSync(join(directory, 'current'))).toBe(current);
    }

    writeFileSync(join(validBuild, '.env'), 'secret=value\n');
    expect(() => prepareRelease(directory, validBuild)).toThrow(/RELEASE_INPUT_FORBIDDEN/u);
    expect(readlinkSync(join(directory, 'current'))).toBe(current);

    const safe = build(root());
    expect(prepareRelease(directory, safe)).toMatch(/RELEASE_PREPARED/u);
    expect(readlinkSync(join(directory, 'current'))).toBe(current);
    expect(() => prepareRelease(directory, safe)).toThrow(/RELEASE_TARGET_EXISTS/u);
  });

  it('prepares only attested immutable runtime assets and binds source, tree, and manifest digest', () => {
    const directory = root();
    const output = prepareRelease(directory);
    const release = join(directory, 'releases', sha);
    expect(output).toContain(`release=${basename(release)}`);
    expect(existsSync(join(release, '.env'))).toBe(false);
    expect(existsSync(join(release, 'shared'))).toBe(false);
    expect(lstatSync(join(release, 'apps', 'web', 'dist', 'server', 'web-entry.js')).isFile()).toBe(
      true
    );
    const marker = JSON.parse(readFileSync(join(release, '.release-source.json'), 'utf8'));
    expect(marker).toMatchObject({
      gitSha: sha,
      treeSha: tree,
      manifestDigest: expect.any(String)
    });
    expect(
      execFileSync(process.execPath, [manifest, 'verify', release], { encoding: 'utf8' })
    ).toMatch(/RELEASE_MANIFEST_PASS/u);
  });

  it('preflights before pointer or config side effects, atomically swaps a same-root current pointer, and rolls back a failed restart', () => {
    const directory = root();
    prepareRelease(directory);
    const previous = join(directory, 'releases', 'previous');
    mkdirSync(previous);
    symlinkSync(previous, join(directory, 'current'));
    const log = join(directory, 'calls.log');
    const systemctl = stub(
      directory,
      'systemctl',
      'printf "%s\\n" "$*" >> "$EDUTRACK_OPS_RELEASE_TEST_ROOT/calls.log"\ncase "$*" in *edutrack-ops-web.service*) exit 9;; esac'
    );
    const nginx = stub(
      directory,
      'nginx',
      'printf "%s\\n" "$*" >> "$EDUTRACK_OPS_RELEASE_TEST_ROOT/calls.log"'
    );

    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_ACTIVATION_SERVICE_FAILED/u);
    expect(readlinkSync(join(directory, 'current'))).toBe(previous);
    expect(readFileSync(log, 'utf8')).toContain('restart edutrack-ops-web.service');

    writeFileSync(
      join(directory, 'releases', sha, 'apps', 'web', 'dist', 'server', 'web-entry.js'),
      'corrupt\n'
    );
    const before = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_MANIFEST_DIGEST_MISMATCH/u);
    expect(readlinkSync(join(directory, 'current'))).toBe(previous);
    expect(readFileSync(log, 'utf8')).toBe(before);
  });

  it('uses a same-root temporary symlink for a successful pointer replacement and leaves no staging pointer behind', () => {
    const directory = root();
    prepareRelease(directory);
    const previous = join(directory, 'releases', 'previous');
    mkdirSync(previous);
    symlinkSync(previous, join(directory, 'current'));
    const systemctl = stub(directory, 'systemctl', ':');
    const nginx = stub(directory, 'nginx', ':');

    expect(
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toMatch(/RELEASE_ACTIVATED/u);
    expect(readlinkSync(join(directory, 'current'))).toBe(join(directory, 'releases', sha));
    expect(readdirSync(directory).filter((name) => name.startsWith('.current.'))).toEqual([]);
  });

  it('refuses a non-release previous pointer and production-looking test override', () => {
    const directory = root();
    prepareRelease(directory);
    const outside = join(directory, 'not-a-release');
    mkdirSync(outside);
    symlinkSync(outside, join(directory, 'current'));
    const systemctl = stub(directory, 'systemctl', ':');
    const nginx = stub(directory, 'nginx', ':');
    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_PREVIOUS_POINTER_INVALID/u);

    expect(() =>
      execFileSync('bash', [prepare, sha, build(directory)], {
        env: {
          ...process.env,
          EDUTRACK_OPS_RELEASE_TEST_MODE: '1',
          EDUTRACK_OPS_RELEASE_TEST_ROOT: '/srv/edutrack-ops'
        },
        encoding: 'utf8'
      })
    ).toThrow(/RELEASE_TEST_ROOT_INVALID/u);
  });

  it('contains no source-checkout path in the deployment assets', () => {
    const assets = [prepare, activate, manifest]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(assets).not.toContain('/home/deploy');
  });
});
