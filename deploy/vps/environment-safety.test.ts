import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const prepareScript = resolve('deploy/vps/prepare-environment.mjs');
const validateScript = resolve('deploy/vps/validate-environment.mjs');
const nginxConfig = resolve('deploy/vps/nginx.conf');
const logrotateConfig = resolve('deploy/vps/logrotate.conf');
const crontabConfig = resolve('deploy/vps/crontab');
const backupScript = resolve('deploy/vps/backup-postgres.sh');
const activateHostScript = resolve('deploy/vps/activate-host.sh');
const temporaryDirectories: string[] = [];

function fixtureFiles() {
  const directory = mkdtempSync(join(tmpdir(), 'edutrack-vps-env-'));
  temporaryDirectories.push(directory);
  const source = join(directory, 'source.env');
  const target = join(directory, 'target.env');

  writeFileSync(
    source,
    [
      'VITE_TURNSTILE_SITE_KEY=staging-site-key',
      'TURNSTILE_SECRET_KEY=staging-secret-key',
      'PAYOS_CLIENT_ID=must-not-leak',
      'PAYOS_API_KEY=must-not-leak',
      'PAYOS_CHECKSUM_KEY=must-not-leak',
      'ZALO_BOT_TOKEN=must-not-leak',
      'ZALO_BOT_ENABLED=true',
      'ZALO_BOT_DAILY_DIGEST_ENABLED=true',
      'ZALO_BOT_DRY_RUN=false',
      'ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED=true',
    ].join('\n'),
    'utf8'
  );
  return { source, target };
}

function productionValidationEnvironment(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    DEPLOYMENT_STAGE: 'production',
    APP_URL: 'https://vps.thienuy.edu.vn',
    PUBLIC_BASE_URL: 'https://vps.thienuy.edu.vn',
    INTERNAL_API_BASE_URL: 'http://127.0.0.1:3000',
    APP_COMMIT_SHA: '99d2ec4e42af7bb0e696e05656078ed2ce6049af',
    GLOBAL_WRITE_FREEZE: 'false',
    DATABASE_URL: 'postgres://edutrack:secret@127.0.0.1:5432/edutrack',
    STORAGE_LOCAL_ROOT: '/srv/edutrack/shared/uploads',
    STORAGE_SIGNING_SECRET: 's'.repeat(32),
    SESSION_SECRET: 's'.repeat(32),
    OTP_PEPPER: 'o'.repeat(32),
    LOOKUP_CHALLENGE_SECRET: 'l'.repeat(32),
    CRON_SECRET: 'c'.repeat(32),
    VITE_TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    POSTGRES_BACKUP_MODE: 'local',
    POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT: '85',
    POSTGRES_BACKUP_AGE_RECIPIENT: `age1${'a'.repeat(58)}`,
    POSTGRES_BACKUP_RCLONE_REMOTE: '',
    ...overrides,
  };
}

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});
describe('VPS environment safety', () => {
  it('keeps logrotate syntax on Unix line endings', () => {
    expect(readFileSync(logrotateConfig, 'utf8')).not.toContain('\r');
  });

  it('makes user-local operational tools available to cron jobs', () => {
    const config = readFileSync(crontabConfig, 'utf8');
    expect(config).toContain(
      'PATH=/home/deploy/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    );
    expect(config).toContain(
      'bash /srv/edutrack/shared/ops/current/backup-postgres.sh >> /srv/edutrack/shared/logs/backup.log 2>&1'
    );
  });

  it('keeps local-only backup explicit, encrypted, bounded, and disk guarded', () => {
    const script = readFileSync(backupScript, 'utf8');
    expect(script).toContain('BACKUP_MODE=${POSTGRES_BACKUP_MODE:-}');
    expect(script).toContain("BACKUP_MODE} == 'offsite'");
    expect(script).toContain('sha256sum -c');
    expect(script).toContain('RETENTION_DAYS * 1440');
    expect(script).toContain('MAX_DISK_USAGE_PERCENT');
    expect(script).toContain('losing the VPS can destroy production and every backup');
  });

  it('terminates TLS and redirects plaintext traffic before proxying the app', () => {
    const config = readFileSync(nginxConfig, 'utf8');
    expect(config).toContain('listen 443 ssl http2;');
    expect(config).toContain('return 308 https://REPLACE_WITH_CERT_NAME$request_uri;');
    expect(config).toContain('/etc/letsencrypt/live/REPLACE_WITH_CERT_NAME/fullchain.pem');
    expect(config).toContain('Strict-Transport-Security');
  });

  it('requests short-lived IP certificates with a compatible Certbot and renewal timer', () => {
    const script = readFileSync(activateHostScript, 'utf8');
    expect(script).toContain('--ip-address "${PRIMARY_CERT_NAME}"');
    expect(script).toContain('--preferred-profile shortlived');
    expect(script).toContain('Certbot 5.4 or newer');
    expect(script).toContain('snap.certbot.renew.timer');
    expect(script).toContain('${BASH_SOURCE[0]}');
    expect(script).toContain('trap rollback_nginx ERR');
    expect(script).toContain('/etc/letsencrypt/options-ssl-nginx.conf');
    expect(script).toContain('/etc/letsencrypt/ssl-dhparams.pem');
  });

  it('generates staging defaults without copying external side-effect credentials', () => {
    const fixture = fixtureFiles();
    const result = spawnSync(process.execPath, [prepareScript, fixture.source, fixture.target], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VPS_DEPLOYMENT_STAGE: 'staging',
        VPS_DATABASE_PASSWORD: 'local-only-password',
        VPS_PUBLIC_ORIGIN: 'https://vps.thienuy.edu.vn',
        APP_COMMIT_SHA: '99d2ec4e42af7bb0e696e05656078ed2ce6049af',
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const output = parseEnv(readFileSync(fixture.target, 'utf8'));
    expect(output).toMatchObject({
      DEPLOYMENT_STAGE: 'staging',
      STORAGE_BACKEND: 'local',
      STORAGE_LOCAL_ROOT: '/srv/edutrack/shared/uploads',
      POSTGRES_BACKUP_MODE: 'local',
      POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT: '85',
      VITE_REALTIME_POLL_MS: '10000',
      PAYOS_ENABLED: 'false',
      VITE_PAYOS_ENABLED: 'false',
      PAYOS_CLIENT_ID: '',
      PAYOS_API_KEY: '',
      PAYOS_CHECKSUM_KEY: '',
      ZALO_BOT_TOKEN: '',
      ZALO_BOT_ENABLED: 'false',
      ZALO_BOT_DAILY_DIGEST_ENABLED: 'false',
      ZALO_BOT_DRY_RUN: 'true',
      ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED: 'false',
      GLOBAL_WRITE_FREEZE: 'false',
      CANONICAL_STUDENT_READ_MODE: 'legacy_compare',
    });
    expect(output.STORAGE_SIGNING_SECRET).toHaveLength(64);
    expect(output.SESSION_SECRET).toHaveLength(64);
    expect(output).not.toHaveProperty('DATA_BACKEND');

    const validation = spawnSync(process.execPath, [validateScript], {
      encoding: 'utf8',
      env: { ...process.env, ...output },
    });
    expect(validation.status, validation.stderr).toBe(0);
    expect(validation.stdout).toContain('Missing required: none');
  });

  it('refuses to prepare production without an explicit cutover confirmation', () => {
    const fixture = fixtureFiles();
    const result = spawnSync(process.execPath, [prepareScript, fixture.source, fixture.target], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VPS_DEPLOYMENT_STAGE: 'production',
        VPS_DATABASE_PASSWORD: 'local-only-password',
        VPS_PUBLIC_ORIGIN: 'https://vps.thienuy.edu.vn',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VPS_CONFIRM_PRODUCTION_CUTOVER=approved');
  });

  it('requires a public origin when preparing an environment', () => {
    const fixture = fixtureFiles();
    const result = spawnSync(process.execPath, [prepareScript, fixture.source, fixture.target], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VPS_DEPLOYMENT_STAGE: 'staging',
        VPS_DATABASE_PASSWORD: 'local-only-password',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VPS_PUBLIC_ORIGIN');
  });

  it('rejects a non-HTTPS public origin', () => {
    const fixture = fixtureFiles();
    const result = spawnSync(process.execPath, [prepareScript, fixture.source, fixture.target], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VPS_DEPLOYMENT_STAGE: 'staging',
        VPS_DATABASE_PASSWORD: 'local-only-password',
        VPS_PUBLIC_ORIGIN: 'http://vps.thienuy.edu.vn',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VPS_PUBLIC_ORIGIN must use HTTPS');
  });

  it('rejects an obsolete canonical student read mode', () => {
    const result = spawnSync(process.execPath, [validateScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        CANONICAL_STUDENT_READ_MODE: 'legacy',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CANONICAL_STUDENT_READ_MODE');
  });

  it('accepts an explicitly selected encrypted local-only backup with a warning', () => {
    const result = spawnSync(process.execPath, [validateScript], {
      encoding: 'utf8',
      env: productionValidationEnvironment(),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('cannot recover from total VPS or disk loss');
  });

  it('still requires a remote when offsite backup mode is selected', () => {
    const result = spawnSync(process.execPath, [validateScript], {
      encoding: 'utf8',
      env: productionValidationEnvironment({ POSTGRES_BACKUP_MODE: 'offsite' }),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('POSTGRES_BACKUP_RCLONE_REMOTE');
  });

  it('rejects an unsafe backup disk usage limit', () => {
    const result = spawnSync(process.execPath, [validateScript], {
      encoding: 'utf8',
      env: productionValidationEnvironment({
        POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT: '99',
      }),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT');
  });

  it('refuses a production environment without encrypted backup settings', () => {
    const result = spawnSync(process.execPath, [validateScript], {
      encoding: 'utf8',
      env: productionValidationEnvironment({
        POSTGRES_BACKUP_AGE_RECIPIENT: '',
      }),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('POSTGRES_BACKUP_AGE_RECIPIENT');
  });
});
