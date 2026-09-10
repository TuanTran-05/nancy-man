import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = new URL('./configure-telemetry-environment.sh', import.meta.url).pathname;
const releaseSha = '0123456789abcdef0123456789abcdef01234567';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'edutrack-telemetry-env-test-'));
  const config = join(root, 'etc', 'edutrack-ops');
  const release = join(root, 'releases', releaseSha);
  mkdirSync(config, { recursive: true });
  mkdirSync(release, { recursive: true });
  writeFileSync(
    join(release, '.release-source.json'),
    `${JSON.stringify({ gitSha: releaseSha, treeSha: 'a'.repeat(40), manifestDigest: 'b'.repeat(64) })}\n`
  );
  for (const name of [
    'api.env',
    'web.env',
    'collector.env',
    'config-agent.env',
    'sql-worker.env'
  ]) {
    writeFileSync(
      join(config, name),
      `KEEP_${name.replace(/[^A-Z]/giu, '_')}=true\nOPS_TELEMETRY_ENABLED=false\nOPS_PM2_ERROR_LOG_PATH=/srv/edutrack/shared/logs/app-error.log\n`
    );
  }
  return { root, config, release };
}

function run(root: string, config: string, release: string): string {
  return execFileSync('bash', [script, release], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EDUTRACK_OPS_TELEMETRY_TEST_MODE: '1',
      EDUTRACK_OPS_TELEMETRY_TEST_ROOT: root,
      EDUTRACK_OPS_CONFIG_DIRECTORY: config
    }
  });
}

describe('configure telemetry environment', () => {
  it('atomically configures every runtime environment with the attested release and scoped credential', () => {
    const { root, config, release } = fixture();

    expect(run(root, config, release)).toContain(`OPS_TELEMETRY_ENV_CONFIGURED release=${releaseSha}`);

    for (const [name, hmacPath] of [
      ['api.env', undefined],
      ['web.env', '/run/credentials/edutrack-ops-web.service/ops-telemetry-hmac'],
      ['collector.env', '/run/credentials/edutrack-ops-collector.service/ops-telemetry-hmac'],
      ['config-agent.env', '/run/credentials/ops-config-agent.service/ops-telemetry-hmac'],
      ['sql-worker.env', '/run/credentials/edutrack-ops-sql-worker.service/ops-telemetry-hmac']
    ] as const) {
      const environment = readFileSync(join(config, name), 'utf8');
      expect(environment).toContain('OPS_TELEMETRY_ENABLED=true');
      expect(environment).toContain(
        'OPS_TELEMETRY_INGEST_URL=https://man.thienuy.edu.vn/api/v1/ingest/server'
      );
      expect(environment).toContain('OPS_TELEMETRY_KEY_ID=edutrack-ops-runtime');
      expect(environment).toContain('OPS_TELEMETRY_HMAC_SECRET_REFERENCE=ops-telemetry-hmac');
      expect(environment).toContain(`OPS_TELEMETRY_RELEASE=${releaseSha}`);
      expect(environment).toContain('OPS_TELEMETRY_SPOOL_DIRECTORY=/var/lib/edutrack-ops/telemetry');
      if (hmacPath) expect(environment).toContain(`OPS_TELEMETRY_HMAC_FILE=${hmacPath}`);
    }
    expect(readFileSync(join(config, 'collector.env'), 'utf8')).toContain(
      'OPS_PM2_ERROR_LOG_PATH=/srv/edutrack/shared/logs/app-error.log'
    );
  });

  it('rejects a release marker that does not match the release directory before editing environments', () => {
    const { root, config, release } = fixture();
    const before = readFileSync(join(config, 'api.env'), 'utf8');
    writeFileSync(
      join(release, '.release-source.json'),
      `${JSON.stringify({ gitSha: 'f'.repeat(40), treeSha: 'a'.repeat(40), manifestDigest: 'b'.repeat(64) })}\n`
    );

    expect(() => run(root, config, release)).toThrow(/OPS_TELEMETRY_RELEASE_ID_MISMATCH/u);
    expect(readFileSync(join(config, 'api.env'), 'utf8')).toBe(before);
  });
});
