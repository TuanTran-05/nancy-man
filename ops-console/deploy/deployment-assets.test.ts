import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('deployment assets', () => {
  it('binds only Ops Web to loopback and never starts PM2 or touches the EduTrack current symlink', () => {
    const release = read('deploy/release-ops.sh');
    expect(release).toContain('/srv/edutrack-ops/current');
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
    expect(read('deploy/web.env.example')).not.toMatch(/(token|password|postgres:\/\/).+\S/i);
    expect(read('deploy/collector.env.example')).not.toContain('secret');
  });
});
