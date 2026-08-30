import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
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

function sourceRepository(): { directory: string; sha: string; tree: string } {
  const directory = mkdtempSync(join(tmpdir(), 'edutrack-ops-release-source-'));
  execFileSync('git', ['init', '--initial-branch=main', directory]);
  execFileSync('git', ['-C', directory, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', directory, 'config', 'user.name', 'Release Test']);
  for (const path of [
    'deploy/ops/env/api.env.example',
    'deploy/ops/env/collector.env.example',
    'deploy/ops/env/sql-worker.env.example',
    'deploy/ops/env/web.env.example',
    'deploy/ops/nginx/man.thienuy.edu.vn-api.conf',
    'deploy/ops/systemd/edutrack-ops-api.service',
    'deploy/ops/systemd/edutrack-ops-web.service',
    'deploy/ops/systemd/edutrack-ops-collector.service',
    'deploy/ops/systemd/edutrack-ops-collector-failed@.service',
    'deploy/ops/systemd/edutrack-ops-processor.service',
    'deploy/ops/systemd/edutrack-ops-notifier.service',
    'deploy/ops/systemd/edutrack-ops-sql-worker.service',
    'deploy/ops/systemd/edutrack-ops-migrate.service'
  ]) {
    mkdirSync(join(directory, path, '..'), { recursive: true });
    writeFileSync(join(directory, path), `committed:${path}\n`);
  }
  writeFileSync(join(directory, 'deploy', 'ops', 'release-manifest.mjs'), 'committed-manifest\n');
  execFileSync('git', ['-C', directory, 'add', '.']);
  execFileSync('git', ['-C', directory, 'commit', '-m', 'fixture release assets']);
  const sourceSha = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).trim();
  const sourceTree = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD^{tree}'], {
    encoding: 'utf8'
  }).trim();
  return { directory, sha: sourceSha, tree: sourceTree };
}

function stub(directory: string, name: string, body: string): string {
  const path = join(directory, 'stubs', name);
  mkdirSync(join(directory, 'stubs'), { recursive: true });
  const normalizedBody =
    name === 'systemctl' && body === ':' ? 'case "${1:-}" in is-active) exit 1;; esac\n:' : body;
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${normalizedBody}\n`);
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

function refreshManifest(release: string): void {
  execFileSync(process.execPath, [manifest, 'generate', release]);
  const digest = createHash('sha256')
    .update(
      `${JSON.stringify(JSON.parse(readFileSync(join(release, '.release-manifest.json'), 'utf8')))}\n`
    )
    .digest('hex');
  const marker = JSON.parse(readFileSync(join(release, '.release-source.json'), 'utf8'));
  writeFileSync(
    join(release, '.release-source.json'),
    `${JSON.stringify({ ...marker, manifestDigest: digest })}\n`
  );
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

  it('copies deployment payload bytes from the requested Git commit, never dirty checkout files', () => {
    const directory = root();
    const source = sourceRepository();
    const verifiedBuild = build(directory, source.sha);
    writeFileSync(
      join(verifiedBuild, '.edutrack-ops-build.json'),
      `${JSON.stringify({ gitSha: source.sha, treeSha: source.tree })}\n`
    );
    writeFileSync(
      join(source.directory, 'deploy', 'ops', 'nginx', 'man.thienuy.edu.vn-api.conf'),
      'dirty-checkout-byte\n'
    );
    writeFileSync(
      join(source.directory, 'deploy', 'ops', 'release-manifest.mjs'),
      'dirty-manifest-byte\n'
    );

    run(prepare, directory, [source.sha, verifiedBuild], {
      EDUTRACK_OPS_RELEASE_REPOSITORY: source.directory
    });
    const release = join(directory, 'releases', source.sha);
    expect(
      readFileSync(join(release, 'deploy', 'ops', 'nginx', 'man.thienuy.edu.vn-api.conf'), 'utf8')
    ).toBe('committed:deploy/ops/nginx/man.thienuy.edu.vn-api.conf\n');
    expect(readFileSync(join(release, 'deploy', 'ops', 'release-manifest.mjs'), 'utf8')).toBe(
      'committed-manifest\n'
    );
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
      'printf "%s\\n" "$*" >> "$EDUTRACK_OPS_RELEASE_TEST_ROOT/calls.log"\ncase "$*" in verify*) ;; is-active*) exit 1;; start\\ edutrack-ops-web.service) exit 9;; esac'
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
    expect(readFileSync(log, 'utf8')).toContain('start edutrack-ops-web.service');

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

  it('does not install any config assets when marker or manifest preflight is incomplete', () => {
    const directory = root();
    prepareRelease(directory);
    const systemctl = stub(directory, 'systemctl', ':');
    const nginx = stub(directory, 'nginx', ':');
    writeFileSync(join(directory, 'releases', sha, '.release-source.json'), '{broken\n');

    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_MARKER_INVALID/u);
    expect(existsSync(join(directory, 'installed'))).toBe(false);
    expect(existsSync(join(directory, 'current'))).toBe(false);
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

  it('rejects traversal and escaped command stubs before a test operation can leave its fixture', () => {
    const directory = root();
    const escaped = mkdtempSync(join(tmpdir(), 'ops-release-escaped-'));
    mkdirSync(join(escaped, 'releases'));
    const escapedRoot = join(directory, '..', basename(escaped));
    const escapedSystemctl = stub(escaped, 'systemctl', 'exit 99');
    const escapedNginx = stub(escaped, 'nginx', 'exit 99');

    expect(() =>
      run(prepare, directory, [sha, build(directory)], {
        EDUTRACK_OPS_RELEASE_TEST_ROOT: escapedRoot
      })
    ).toThrow(/RELEASE_TEST_ROOT_INVALID/u);
    prepareRelease(directory);
    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: join(
          directory,
          '..',
          basename(escaped),
          'stubs',
          basename(escapedSystemctl)
        ),
        EDUTRACK_OPS_TEST_NGINX: join(
          directory,
          '..',
          basename(escaped),
          'stubs',
          basename(escapedNginx)
        )
      })
    ).toThrow(/RELEASE_TEST_SYSTEMCTL_INVALID/u);
  });

  it('contains no source-checkout path in the deployment assets', () => {
    const assets = [prepare, activate, manifest]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(assets).not.toContain(['/home', 'deploy'].join('/'));
  });

  it('preflights malformed systemd units without any manager, config, or pointer mutation', () => {
    const directory = root();
    prepareRelease(directory);
    const release = join(directory, 'releases', sha);
    writeFileSync(
      join(release, 'deploy', 'ops', 'systemd', 'edutrack-ops-api.service'),
      'not-a-unit\n'
    );
    refreshManifest(release);
    const log = join(directory, 'calls.log');
    const systemctl = stub(
      directory,
      'systemctl',
      'printf "%s\\n" "$*" >> "$EDUTRACK_OPS_RELEASE_TEST_ROOT/calls.log"\ncase "$*" in verify*) exit 9;; esac'
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
    ).toThrow(/RELEASE_SYSTEMD_PREFLIGHT_FAILED/u);
    expect(existsSync(join(directory, 'installed'))).toBe(false);
    expect(existsSync(join(directory, 'current'))).toBe(false);
    expect(readFileSync(log, 'utf8')).toContain('verify');
    expect(readFileSync(log, 'utf8')).not.toMatch(/daemon-reload|restart|start|stop/u);
  });

  it('stops and confirms the writer cohort before the pointer swap, then rolls back pointer, services, and exact config bytes on late failure', () => {
    const directory = root();
    prepareRelease(directory);
    const previous = join(directory, 'releases', 'previous');
    mkdirSync(previous);
    symlinkSync(previous, join(directory, 'current'));
    mkdirSync(join(directory, 'installed', 'systemd'), { recursive: true });
    mkdirSync(join(directory, 'installed', 'nginx'), { recursive: true });
    writeFileSync(
      join(directory, 'installed', 'systemd', 'edutrack-ops-web.service'),
      'old-web-unit\n'
    );
    writeFileSync(
      join(directory, 'installed', 'nginx', 'man.thienuy.edu.vn-api.conf'),
      'old-vhost\n'
    );
    const log = join(directory, 'calls.log');
    const systemctl = stub(
      directory,
      'systemctl',
      'printf "%s\\n" "$*" >> "$EDUTRACK_OPS_RELEASE_TEST_ROOT/calls.log"\ncase "$*" in verify*) ;; "is-active --quiet edutrack-ops-web.service"|"is-active --quiet edutrack-ops-collector.service") exit 1;; start\\ edutrack-ops-collector.service) exit 9;; esac'
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
    const calls = readFileSync(log, 'utf8');
    expect(calls.indexOf('stop edutrack-ops-web.service')).toBeLessThan(
      calls.indexOf('restart edutrack-ops-api.service')
    );
    expect(calls).toContain('stop edutrack-ops-collector.service');
    expect(readlinkSync(join(directory, 'current'))).toBe(previous);
    expect(
      readFileSync(join(directory, 'installed', 'systemd', 'edutrack-ops-web.service'), 'utf8')
    ).toBe('old-web-unit\n');
    expect(
      readFileSync(join(directory, 'installed', 'nginx', 'man.thienuy.edu.vn-api.conf'), 'utf8')
    ).toBe('old-vhost\n');
  });

  it('routes Nginx reload failure through the full rollback transaction', () => {
    const directory = root();
    prepareRelease(directory);
    mkdirSync(join(directory, 'installed', 'nginx'), { recursive: true });
    writeFileSync(
      join(directory, 'installed', 'nginx', 'man.thienuy.edu.vn-api.conf'),
      'previous-vhost\n'
    );
    const systemctl = stub(directory, 'systemctl', ':');
    const nginx = stub(directory, 'nginx', 'case "$*" in *"-s reload") exit 9;; esac');

    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_NGINX_RELOAD_FAILED/u);
    expect(existsSync(join(directory, 'current'))).toBe(false);
    expect(
      readFileSync(join(directory, 'installed', 'nginx', 'man.thienuy.edu.vn-api.conf'), 'utf8')
    ).toBe('previous-vhost\n');
  });

  it('keeps a stateful writer cohort on the previous generation after a failed collector start', () => {
    const directory = root();
    prepareRelease(directory);
    const previous = join(directory, 'releases', 'previous');
    mkdirSync(previous);
    symlinkSync(previous, join(directory, 'current'));
    mkdirSync(join(directory, 'installed', 'systemd'), { recursive: true });
    mkdirSync(join(directory, 'installed', 'nginx'), { recursive: true });
    writeFileSync(join(directory, 'installed', 'systemd', 'edutrack-ops-web.service'), 'old-web\n');
    writeFileSync(join(directory, 'installed', 'nginx', 'man.thienuy.edu.vn-api.conf'), 'old-nginx\n');
    execFileSync('chmod', ['0640', join(directory, 'installed', 'systemd', 'edutrack-ops-web.service')]);
    mkdirSync(join(directory, 'state'), { recursive: true });
    for (const service of [
      'edutrack-ops-api.service',
      'edutrack-ops-web.service',
      'edutrack-ops-collector.service'
    ]) {
      writeFileSync(join(directory, 'state', service), 'previous\n');
    }
    const systemctl = stub(
      directory,
      'systemctl',
      'root="$EDUTRACK_OPS_RELEASE_TEST_ROOT"\ncommand="${1:-}"\nshift || true\ncase "$command" in\n  verify|daemon-reload) exit 0;;\n  is-active) test -f "$root/state/${2:-}";;\n  stop) service="${1:-}"; rm -f -- "$root/state/$service";;\n  restart|start) service="${1:-}"; basename "$(readlink "$root/current")" > "$root/state/$service"; if [[ "$command" == start && "$service" == edutrack-ops-collector.service ]]; then exit 9; fi;;\nesac'
    );
    const nginx = stub(directory, 'nginx', ':');

    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_ACTIVATION_SERVICE_FAILED/u);
    expect(readlinkSync(join(directory, 'current'))).toBe(previous);
    expect(readFileSync(join(directory, 'state', 'edutrack-ops-api.service'), 'utf8')).toBe(
      'previous\n'
    );
    expect(readFileSync(join(directory, 'state', 'edutrack-ops-web.service'), 'utf8')).toBe(
      'previous\n'
    );
    expect(readFileSync(join(directory, 'state', 'edutrack-ops-collector.service'), 'utf8')).toBe(
      'previous\n'
    );
    expect(
      readdirSync(join(directory, 'state')).some(
        (service) => readFileSync(join(directory, 'state', service), 'utf8') === `${sha}\n`
      )
    ).toBe(false);
    expect(readFileSync(join(directory, 'installed', 'systemd', 'edutrack-ops-web.service'), 'utf8')).toBe(
      'old-web\n'
    );
    expect(statSync(join(directory, 'installed', 'systemd', 'edutrack-ops-web.service')).mode & 0o777).toBe(
      0o640
    );
  });

  it('reports the primary failure and rollback failure when an attempted candidate service cannot stop', () => {
    const directory = root();
    prepareRelease(directory);
    const previous = join(directory, 'releases', 'previous');
    mkdirSync(previous);
    symlinkSync(previous, join(directory, 'current'));
    mkdirSync(join(directory, 'state'), { recursive: true });
    writeFileSync(join(directory, 'state', 'edutrack-ops-api.service'), 'previous\n');
    const systemctl = stub(
      directory,
      'systemctl',
      'root="$EDUTRACK_OPS_RELEASE_TEST_ROOT"\ncommand="${1:-}"\nshift || true\ncase "$command" in\n  verify|daemon-reload) exit 0;;\n  is-active) test -f "$root/state/${2:-}";;\n  stop) service="${1:-}"; if [[ "$service" == edutrack-ops-api.service && "$(cat "$root/state/$service" 2>/dev/null || true)" != previous ]]; then exit 23; fi; rm -f -- "$root/state/$service";;\n  restart|start) service="${1:-}"; if [[ "$command" == start && -f "$root/state/$service" ]]; then exit 24; fi; basename "$(readlink "$root/current")" > "$root/state/$service"; if [[ "$command" == start && "$service" == edutrack-ops-collector.service ]]; then exit 9; fi;;\nesac'
    );
    const nginx = stub(directory, 'nginx', ':');

    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_ROLLBACK_FAILED primary=RELEASE_ACTIVATION_SERVICE_FAILED/u);
    expect(readFileSync(join(directory, 'state', 'edutrack-ops-api.service'), 'utf8')).toBe(`${sha}\n`);
  });

  it('rejects symlinked test transaction and installed ancestors without escaping the fixture', () => {
    for (const ancestor of ['.activation-tmp', 'installed'] as const) {
      const directory = root();
      const outside = mkdtempSync(join(tmpdir(), 'ops-release-escaped-'));
      prepareRelease(directory);
      symlinkSync(outside, join(directory, ancestor));
      const systemctl = stub(directory, 'systemctl', ':');
      const nginx = stub(directory, 'nginx', ':');

      expect(() =>
        run(activate, directory, [sha], {
          EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
          EDUTRACK_OPS_TEST_NGINX: nginx
        })
      ).toThrow(/RELEASE_TEST_DIRECTORY_INVALID/u);
      expect(readdirSync(outside)).toEqual([]);
    }
  });

  it('cleans its exact transaction directory when prior config validation fails', () => {
    const directory = root();
    prepareRelease(directory);
    mkdirSync(join(directory, 'installed', 'systemd'), { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), 'ops-release-escaped-'));
    symlinkSync(outside, join(directory, 'installed', 'systemd', 'edutrack-ops-api.service'));
    const systemctl = stub(directory, 'systemctl', ':');
    const nginx = stub(directory, 'nginx', ':');

    expect(() =>
      run(activate, directory, [sha], {
        EDUTRACK_OPS_TEST_SYSTEMCTL: systemctl,
        EDUTRACK_OPS_TEST_NGINX: nginx
      })
    ).toThrow(/RELEASE_PRIOR_CONFIG_INVALID/u);
    expect(
      readdirSync(join(directory, '.activation-tmp')).filter((name) =>
        name.startsWith('edutrack-ops-activate.')
      )
    ).toEqual([]);
  });
});
