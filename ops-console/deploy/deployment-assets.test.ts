import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('deployment assets', () => {
  it('pins immutable Beszel v0.18.8 amd64 artifacts', () => {
    const version = read('deploy/beszel/version.env');
    expect(version).toContain('BESZEL_VERSION=0.18.8');
    expect(version).toContain('BESZEL_TAG_COMMIT=0a9cad31d90b0902302d7a3c538b53c2a548c3cb');
    expect(version).toContain('BESZEL_HUB_SHA256=c4924f01a3def7d307fe7cb9776dee547240b51aa0e7222b7e6d47c2cbdf9916');
    expect(version).toContain('BESZEL_AGENT_SHA256=ea964141aa4182742475c0a75b29001fc591eb39ce0f63a33bd3cff04539bcf9');
    expect(version).not.toMatch(/latest|main|AUTO_UPDATE/);
    expect(read('deploy/beszel/LICENSE')).toContain('MIT License');
  });

  it('keeps the Beszel installer pinned, root-only and non-activating', () => {
    const installer = read('deploy/beszel/install-beszel.sh');
    expect(installer).toContain('id -u');
    expect(installer).toContain('uname -m');
    expect(installer).toContain('mktemp -d');
    expect(installer).toContain('curl -fL');
    expect(installer).toContain('sha256sum -c');
    expect(installer).toContain('tar -tzf');
    expect(installer).toContain('^BESZEL_[A-Z0-9_]+=[A-Za-z0-9._-]+$');
    expect(installer).toContain('https://github.com/henrygd/beszel/releases/download/v${BESZEL_VERSION}/${BESZEL_HUB_ARCHIVE}');
    expect(installer).toContain('https://github.com/henrygd/beszel/releases/download/v${BESZEL_VERSION}/${BESZEL_AGENT_ARCHIVE}');
    expect(installer).toContain('mv -Tf');
    expect(installer).not.toMatch(/latest|\bmain\b|\bupdate\b|systemctl\s+(start|enable)|\bpm2\b|\/srv\/edutrack\/current|nginx/i);
  });

  it('keeps Hub and Agent isolated and hardened', () => {
    const hub = read('deploy/systemd/beszel-hub.service');
    const agent = read('deploy/systemd/beszel-agent.service');
    expect(hub).toContain('User=beszel-hub');
    expect(agent).toContain('User=beszel-agent');
    expect(hub).toContain('ExecStart=/srv/beszel/current/beszel serve --http 127.0.0.1:8090');
    expect(agent).toContain('ExecStart=/srv/beszel/current/beszel-agent');
    expect(read('deploy/beszel/agent.env.example')).toContain('DISABLE_SSH=true');
    expect(agent).not.toContain('45876');
    for (const unit of [hub, agent]) {
      expect(unit).toContain('NoNewPrivileges=true');
      expect(unit).toContain('PrivateDevices=true');
      expect(unit).toContain('ProtectSystem=strict');
      expect(unit).toContain('CapabilityBoundingSet=');
    }
    expect(read('deploy/beszel/hub.env.example')).not.toMatch(/AUTO_LOGIN|TRUSTED_AUTH_HEADER|USER_EMAIL|USER_PASSWORD/);
    expect(read('deploy/beszel/agent.env.example')).not.toMatch(/^(?:TOKEN|PASSWORD|SECRET)=[^\n]+/im);
  });

  it('uses encrypted consistent Beszel backups and an isolated restore drill', () => {
    const backup = read('deploy/beszel/backup-beszel.sh');
    const restore = read('deploy/beszel/restore-beszel-drill.sh');
    expect(read('deploy/beszel/backup.env.example')).toContain('BESZEL_BACKUP_AGE_RECIPIENT=');
    expect(backup).toContain('data.db');
    expect(backup).toContain('id_ed25519');
    expect(backup).toContain('version.env');
    expect(backup).toContain('sqlite3');
    expect(backup).toContain('.backup');
    expect(backup).toContain('PRAGMA integrity_check');
    expect(backup).toContain('age');
    expect(backup).toContain('sha256sum -c');
    expect(backup).toContain('beszel-daily-');
    expect(backup).toContain('beszel-weekly-');
    expect(backup).not.toContain('install -d -o');
    expect(backup).not.toMatch(/cp\s+.*data\.db|find\s+.*-delete|\/srv\/edutrack/);
    expect(restore).toContain('mktemp');
    expect(restore).toContain('realpath');
    expect(restore).toContain('age');
    expect(restore).toContain('PRAGMA integrity_check');
    expect(restore).not.toContain('/srv/beszel/shared/hub');
    expect(read('deploy/systemd/beszel-backup.service')).toContain('ExecStart=/usr/local/libexec/edutrack-backup-beszel');
    expect(read('deploy/systemd/beszel-backup.timer')).toContain('Persistent=true');
  });

  it('ships a redacted smoke artifact in every release', () => {
    const build = read('scripts/build-server.mjs');
    const release = read('deploy/release-ops.sh');
    expect(build).toContain("'smoke-beszel': 'src/cli/smoke-beszel.ts'");
    expect(release).toContain('dist/server/smoke-beszel.js');
  });

  it('documents the gated rollout and keeps Beszel disabled by default', () => {
    const collector = read('deploy/collector.env.example');
    const runbook = read('../docs/runbooks/beszel-telemetry-rollout.md');
    expect(collector).toContain('OPS_BESZEL_ENABLED=false');
    expect(collector).toContain('OPS_BESZEL_URL=http://127.0.0.1:8090');
    expect(collector).toContain('OPS_BESZEL_PASSWORD_FILE=/etc/edutrack-ops/beszel-password');
    expect(collector).toContain('OPS_BESZEL_SYSTEM_ID=');
    expect(runbook).toContain('gh release verify-asset v0.18.8');
    expect(runbook).toContain('OPS_BESZEL_ENABLED=false');
    expect(runbook).toContain('OPS_BESZEL_ENABLED=true');
    expect(runbook).toContain('maintenance window');
    expect(runbook).toContain('do not restart PM2');
  });

  it('binds only Ops Web to loopback and never starts PM2 or touches the EduTrack current symlink', () => {
    const release = read('deploy/release-ops.sh');
    expect(release).toContain('/srv/edutrack-ops/current');
    expect(release).toContain('node_modules/better-sqlite3/package.json');
    expect(release).not.toMatch(/pm2\s+(restart|reload|start)|\/srv\/edutrack\/current/);
  });

  it('uses a strict TLS vhost for man.thienuy.edu.vn only', () => {
    const vhost = read('deploy/nginx/man.thienuy.edu.vn.conf');
    expect(vhost).toContain('server_name man.thienuy.edu.vn;');
    expect(vhost).toContain("Content-Security-Policy");
    expect(vhost).toContain('proxy_pass http://127.0.0.1:3101');
    expect(vhost).not.toContain('127.0.0.1:3000');
  });

  it('hardens systemd units and keeps example files free of credentials', () => {
    const units = ['web', 'collector'].map((name) => read(`deploy/systemd/edutrack-ops-${name}.service`)).join('\n');
    expect(units).toContain('NoNewPrivileges=true');
    expect(units).toContain('ProtectSystem=strict');
    expect(units).toContain('ReadWritePaths=/srv/edutrack-ops/shared');
    expect(read('deploy/systemd/edutrack-ops-collector.service')).toContain('NotifyAccess=all');
    expect(read('deploy/systemd/edutrack-ops-collector.service')).toContain('WatchdogSec=45');
    expect(read('deploy/web.env.example')).not.toMatch(/(token|password|postgres:\/\/).+\S/i);
    expect(read('deploy/collector.env.example')).not.toContain('secret');
  });
});
