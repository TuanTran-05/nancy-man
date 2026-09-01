import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const systemdDirectory = new URL('./', import.meta.url);
const environmentDirectory = new URL('../env/', import.meta.url);

const services = {
  api: {
    executable: '/usr/bin/node apps/api/dist/apps/api/src/runtime/main.js',
    user: 'edutrack-ops-api',
    group: 'edutrack-ops-api',
    writablePaths: ['/var/lib/edutrack-ops/object-store']
  },
  web: {
    executable: '/usr/bin/node dist/server/web-server.js',
    user: 'edutrack-ops-web',
    group: 'edutrack-ops-shared',
    workingDirectory: '/srv/edutrack-ops/current/apps/web',
    writablePaths: ['/srv/edutrack-ops/shared']
  },
  collector: {
    executable: '/usr/bin/node apps/web/dist/server/collector-entry.js',
    user: 'edutrack-ops-collector',
    group: 'edutrack-ops-shared',
    writablePaths: ['/srv/edutrack-ops/shared']
  },
  processor: {
    executable: '/usr/bin/node apps/processor/dist/apps/processor/src/runtime/main.js',
    user: 'edutrack-ops-processor',
    group: 'edutrack-ops-processor',
    writablePaths: []
  },
  notifier: {
    executable: '/usr/bin/node apps/notifier/dist/apps/notifier/src/runtime/main.js',
    user: 'edutrack-ops-notifier',
    group: 'edutrack-ops-notifier',
    writablePaths: []
  },
  'sql-worker': {
    executable: '/usr/bin/node apps/sql-worker/dist/apps/sql-worker/src/index.js',
    user: 'edutrack-ops-sql-worker',
    group: 'edutrack-ops-sql',
    writablePaths: ['/run/edutrack-ops']
  },
  migrate: {
    executable: '/usr/bin/node apps/api/dist/apps/api/src/cli/migrate.js',
    user: 'edutrack-ops-migrate',
    group: 'edutrack-ops-migrate',
    writablePaths: []
  }
} as const;

async function unit(name: string): Promise<string> {
  return readFile(new URL(`edutrack-ops-${name}.service`, systemdDirectory), 'utf8');
}

function setting(contents: string, name: string): string[] {
  return contents
    .split('\n')
    .filter((line) => line.startsWith(`${name}=`))
    .map((line) => line.slice(name.length + 1));
}

function groupHasPermission(mode: number, permission: number): boolean {
  return (mode & permission) === permission;
}

function canConnectUnixSocket(input: {
  directoryMode: number;
  socketMode: number;
  directoryGroup: string;
  socketGroup: string;
  identityGroups: string[];
}): boolean {
  const isSocketGroupMember = input.identityGroups.includes(input.socketGroup);
  const canTraverseDirectory =
    input.identityGroups.includes(input.directoryGroup) &&
    groupHasPermission(input.directoryMode, 0o010);
  const canReadAndWriteSocket = isSocketGroupMember && groupHasPermission(input.socketMode, 0o060);
  return canTraverseDirectory && canReadAndWriteSocket;
}

describe('canonical Ops systemd assets', () => {
  it('defines a private config agent with an API-only socket boundary', async () => {
    const agent = await readFile(new URL('ops-config-agent.service', systemdDirectory), 'utf8');
    const api = await unit('api');

    expect(setting(agent, 'User')).toEqual(['edutrack-config-agent']);
    expect(setting(agent, 'Group')).toEqual(['edutrack-config-api']);
    expect(setting(agent, 'SupplementaryGroups')).toEqual([
      'edutrack-config-agent edutrack-ops deploy'
    ]);
    expect(setting(agent, 'RuntimeDirectory')).toEqual(['edutrack-config-agent']);
    expect(setting(agent, 'RuntimeDirectoryMode')).toEqual(['0750']);
    expect(setting(agent, 'StateDirectory')).toEqual(['edutrack-config-agent']);
    expect(setting(agent, 'StateDirectoryMode')).toEqual(['0700']);
    expect(setting(agent, 'ExecStart')).toEqual([
      '/usr/bin/node /srv/edutrack-ops/config-agent/current/apps/config-agent/dist/apps/config-agent/src/index.js'
    ]);
    expect(setting(agent, 'ReadWritePaths')).toEqual([
      '/var/lib/edutrack-config-agent',
      '/srv/edutrack/shared',
      '/etc/edutrack-ops',
      '/srv/edutrack/staging',
      '/srv/edutrack/current',
      '/srv/edutrack/releases'
    ]);
    expect(setting(agent, 'ReadOnlyPaths')).toEqual([
      '/srv/edutrack-ops/config-agent/current',
      '-/etc/beszel/hub/hub.env',
      '-/etc/beszel/agent.env'
    ]);
    expect(setting(agent, 'RestrictAddressFamilies')).toEqual(['AF_UNIX AF_INET AF_INET6']);
    expect(setting(agent, 'CapabilityBoundingSet')).toEqual(['']);
    expect(setting(agent, 'AmbientCapabilities')).toEqual(['']);
    expect(setting(agent, 'SystemCallFilter')).toEqual(['@system-service']);
    expect(setting(agent, 'LimitNOFILE')).toEqual(['4096']);
    expect(setting(agent, 'MemoryMax')).toEqual(['256M']);
    expect(setting(agent, 'TasksMax')).toEqual(['64']);
    expect(setting(agent, 'StartLimitIntervalSec')).toEqual(['60s']);
    expect(setting(agent, 'StartLimitBurst')).toEqual(['5']);
    expect(setting(agent, 'LoadCredential')).toEqual([
      'config-agent-protocol-hmac:/etc/edutrack-ops/credentials/config-agent-protocol-hmac',
      'config-agent-fingerprint-hmac:/etc/edutrack-ops/credentials/config-agent-fingerprint-hmac',
      'config-agent-staging-key:/etc/edutrack-ops/credentials/config-agent-staging-key',
      'config-agent-snapshot-key:/etc/edutrack-ops/credentials/config-agent-snapshot-key'
    ]);
    expect(agent).toContain('Before=edutrack-ops-api.service');
    expect(agent).toContain('After=local-fs.target');
    expect(agent).toContain('StandardOutput=journal');
    expect(agent).toContain('StandardError=journal');
    expect(agent).toContain('LogLevelMax=notice');
    expect(agent).toContain('NoNewPrivileges=true');
    expect(agent).toContain('PrivateTmp=true');
    expect(agent).toContain('PrivateDevices=true');
    expect(agent).toContain('ProtectHome=true');
    expect(agent).toContain('ProtectSystem=strict');
    expect(agent).toContain('RestrictNamespaces=true');
    expect(agent).toContain('RestrictSUIDSGID=true');
    expect(agent).toContain('LockPersonality=true');
    expect(agent).toContain('UMask=0007');
    expect(api).toContain('SupplementaryGroups=edutrack-config-api edutrack-ops-sql');
    expect(api).toContain(
      'LoadCredential=config-agent-protocol-hmac:/etc/edutrack-ops/credentials/config-agent-protocol-hmac'
    );
    expect(api).not.toContain('Requires=ops-config-agent.service');
    expect(api).not.toContain(
      'ExecStartPre=/usr/bin/test -S /run/edutrack-config-agent/agent.sock'
    );
  });

  it('declares explicit runtime directory and socket ownership in tmpfiles assets', async () => {
    const tmpfiles = await readFile(
      new URL('ops-config-agent.tmpfiles.conf', systemdDirectory),
      'utf8'
    );
    expect(tmpfiles).toContain(
      'd /run/edutrack-config-agent 0750 edutrack-config-api edutrack-config-api -'
    );
    expect(tmpfiles).toContain('agent.sock');
    expect(tmpfiles).toContain('0660');
  });

  it('keeps the config-agent environment dark by default and value-free', async () => {
    const environment = await readFile(
      new URL('config-agent.env.example', environmentDirectory),
      'utf8'
    );
    expect(environment).toContain('OPS_CONFIG_AGENT_ENABLED=false');
    expect(environment).toContain(
      'OPS_CONFIG_AGENT_SOCKET_PATH=/run/edutrack-config-agent/agent.sock'
    );
    expect(environment).toContain(
      'OPS_CONFIG_AGENT_PROTOCOL_HMAC_REFERENCE=config-agent-protocol-hmac'
    );
    expect(environment).toContain(
      'OPS_CONFIG_AGENT_FINGERPRINT_HMAC_REFERENCE=config-agent-fingerprint-hmac'
    );
    expect(environment).not.toMatch(
      /(?:postgres(?:ql)?:\/\/|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)/iu
    );
  });

  it('does not require gated SQL credentials while both SQL rollout gates are dark', async () => {
    const [apiEnvironment, sqlWorkerEnvironment, manifestContents] = await Promise.all([
      readFile(new URL('../env/api.env.example', import.meta.url), 'utf8'),
      readFile(new URL('../env/sql-worker.env.example', import.meta.url), 'utf8'),
      readFile(new URL('../config-agent/manifest.yaml', import.meta.url), 'utf8')
    ]);
    const manifest = parseYaml(manifestContents) as {
      sources: Array<{ id: string; group: string; mode: string }>;
    };
    const mandatorySourceIds = manifest.sources.map((source) => source.id);

    expect(apiEnvironment).toContain('OPS_SQL_WORKER_ENABLED=false');
    expect(sqlWorkerEnvironment).toContain('OPS_SQL_READ_ENABLED=false');
    expect(mandatorySourceIds).not.toContain('ops.credentials.ops_sql_audit_encryption_key');
    expect(mandatorySourceIds).not.toContain('ops.credentials.production_read_database_url');
    expect(manifest.sources.find((source) => source.id === 'edutrack.shared_env')).toMatchObject({
      group: 'deploy',
      mode: '0640'
    });
    for (const sourceId of [
      'ops.credentials.ops_database_url',
      'ops.credentials.ops_session_pepper',
      'ops.credentials.ops_rate_limit_pepper',
      'ops.credentials.browser_context_edutrack_v1',
      'ops.credentials.ops_auth_session_pepper',
      'ops.credentials.ops_mfa_encryption_key',
      'ops.credentials.ops_password_fingerprint_pepper',
      'ops.credentials.ops_legacy_monitoring_hmac',
      'ops.credentials.ops_sql_worker_hmac'
    ]) {
      expect(manifest.sources.find((source) => source.id === sourceId)).toMatchObject({
        group: 'edutrack-config-agent',
        mode: '0440'
      });
    }
  });

  it('contains the inactive install, signed negotiation, feature-flag, restart, and smoke sequence', async () => {
    const deploy = await readFile(new URL('../scripts/deploy-release.sh', import.meta.url), 'utf8');
    const install = await readFile(
      new URL('../scripts/install-systemd-assets.sh', import.meta.url),
      'utf8'
    );
    const smokeLauncher = await readFile(
      new URL('../../../apps/api/scripts/config-agent-smoke.sh', import.meta.url),
      'utf8'
    );
    expect(deploy.indexOf('install-systemd-assets.sh')).toBeGreaterThanOrEqual(0);
    expect(deploy.indexOf('start ops-config-agent.service')).toBeGreaterThan(
      deploy.indexOf('install-systemd-assets.sh')
    );
    expect(deploy.indexOf('agent.capabilities')).toBeGreaterThan(
      deploy.indexOf('start ops-config-agent.service')
    );
    expect(deploy.indexOf('OPS_VARIABLES_READ_ONLY_ENABLED=true')).toBeGreaterThan(
      deploy.indexOf('agent.capabilities')
    );
    expect(deploy.indexOf('enable "$AGENT_SERVICE"')).toBeGreaterThan(
      deploy.indexOf('inventory.read')
    );
    expect(deploy.indexOf('OPS_VARIABLES_READ_ONLY_ENABLED=true')).toBeGreaterThan(
      deploy.indexOf('enable "$AGENT_SERVICE"')
    );
    expect(deploy.indexOf('restart edutrack-ops-api.service')).toBeGreaterThan(
      deploy.indexOf('OPS_VARIABLES_READ_ONLY_ENABLED=true')
    );
    expect(deploy.indexOf('healthz')).toBeGreaterThan(
      deploy.indexOf('restart edutrack-ops-api.service')
    );
    expect(deploy).toContain('OPS_VARIABLES_READ_ONLY_ENABLED=true');
    expect(deploy).toContain('inventory.read');
    expect(install).toContain('install -D -m 0755');
    expect(install).toContain('mv -T');
    expect(install).toContain('systemd-analyze verify');
    expect(install).toContain('systemctl daemon-reload');
    expect(install).toContain('chmod 0400');
    expect(install).toContain('process.argv.slice(2)');
    expect(install).not.toContain('process.argv.slice(1)');
    expect(install).toContain("mode.padStart(4, '0') !== source.mode");
    expect(install).toContain('chmod 0750 "$CONFIG_DIRECTORY" "$CREDENTIAL_DIRECTORY"');
    expect(install).toContain('/usr/local/libexec/edutrack-config-agent-smoke');
    expect(install).not.toMatch(/cat\s+.*(?:env|credential)/iu);
    expect(install).not.toContain('printf "%s" "$value"');
    expect(smokeLauncher).toContain(
      '/usr/bin/node /srv/edutrack-ops/current/apps/api/dist/apps/api/src/cli/smoke-config-agent.js'
    );
  });

  it('defines exactly the seven least-privilege service identities and entrypoints', async () => {
    expect(Object.keys(services)).toHaveLength(7);

    for (const [name, expected] of Object.entries(services)) {
      const contents = await unit(name);
      expect(setting(contents, 'User')).toEqual([expected.user]);
      expect(setting(contents, 'Group')).toEqual([expected.group]);
      expect(setting(contents, 'WorkingDirectory')).toEqual([
        'workingDirectory' in expected ? expected.workingDirectory : '/srv/edutrack-ops/current'
      ]);
      expect(setting(contents, 'ExecStart')).toEqual([expected.executable]);
      expect(setting(contents, 'ReadWritePaths')).toEqual(expected.writablePaths);
      expect(contents).toContain('NoNewPrivileges=true');
      expect(contents).toContain('PrivateTmp=true');
      expect(contents).toContain('ProtectHome=true');
      expect(contents).toContain('ProtectSystem=strict');
    }
  });

  it('limits SQLite access to the web and collector service boundary', async () => {
    const units = await Promise.all(
      Object.keys(services).map(async (name) => [name, await unit(name)])
    );
    const sqliteServices = units
      .filter(([, contents]) => contents.includes('/srv/edutrack-ops/shared'))
      .map(([name]) => name);

    expect(sqliteServices).toEqual(['web', 'collector']);
    expect((await unit('api')).includes('/srv/edutrack-ops/shared')).toBe(false);
    expect(setting(await unit('api'), 'ReadWritePaths')).toEqual([
      '/var/lib/edutrack-ops/object-store'
    ]);
  });

  it('gives only the SQL worker identity group-level access to the private SQL socket', async () => {
    const api = await unit('api');
    const worker = await unit('sql-worker');
    const socketGroup = 'edutrack-ops-sql';

    expect(setting(api, 'SupplementaryGroups')).toEqual(['edutrack-config-api edutrack-ops-sql']);
    expect(setting(worker, 'Group')).toEqual([socketGroup]);
    expect(setting(worker, 'RuntimeDirectoryMode')).toEqual(['0750']);

    const access = {
      directoryMode: 0o750,
      socketMode: 0o660,
      directoryGroup: setting(worker, 'Group')[0],
      socketGroup,
      identityGroups: [socketGroup]
    };
    expect(canConnectUnixSocket(access)).toBe(true);
    expect(canConnectUnixSocket({ ...access, identityGroups: ['edutrack-ops-unrelated'] })).toBe(
      false
    );
  });

  it('injects the monitoring adapter HMAC independently into both loopback services', async () => {
    const api = await unit('api');
    const web = await unit('web');
    expect(api).toContain(
      'LoadCredential=ops-legacy-monitoring-hmac:/etc/edutrack-ops/credentials/ops-legacy-monitoring-hmac'
    );
    expect(web).toContain(
      'LoadCredential=ops-legacy-monitoring-hmac:/etc/edutrack-ops/credentials/ops-legacy-monitoring-hmac'
    );
    expect(web).toContain(
      'Environment=OPS_LEGACY_MONITORING_HMAC_FILE=%d/ops-legacy-monitoring-hmac'
    );
  });

  it('keeps collector watchdog and failure notification under the collector identity', async () => {
    const collector = await unit('collector');
    const failed = await readFile(
      new URL('edutrack-ops-collector-failed@.service', systemdDirectory),
      'utf8'
    );

    expect(collector).toContain('OnFailure=edutrack-ops-collector-failed@%n.service');
    expect(collector).toContain('WatchdogSec=45s');
    expect(collector).toContain('NotifyAccess=all');
    expect(setting(failed, 'User')).toEqual(['edutrack-ops-collector']);
    expect(setting(failed, 'Group')).toEqual(['edutrack-ops-shared']);
    expect(setting(failed, 'WorkingDirectory')).toEqual(['/srv/edutrack-ops/current']);
    expect(setting(failed, 'ExecStart')).toEqual([
      '/usr/bin/node apps/web/dist/server/failsafe-entry.js'
    ]);
    expect(setting(failed, 'ReadWritePaths')).toEqual(['/srv/edutrack-ops/shared']);
  });

  it('keeps checked-in web and collector environments as empty secret placeholders', async () => {
    const web = await readFile(new URL('web.env.example', environmentDirectory), 'utf8');
    const collector = await readFile(
      new URL('collector.env.example', environmentDirectory),
      'utf8'
    );
    const secretAssignments =
      /^(?:OPS_(?:DATA_KEY|ALERT_ZALO_BOT_TOKEN|ZALO_WEBHOOK_SECRET|ZALO_LINK_CODE_PEPPER|ZALO_CHAT_HASH_SECRET|ZALO_RECIPIENT_KEY|MONITOR_DATABASE_URL|ALERT_ZALO_RECIPIENT_UIDS|BESZEL_PASSWORD))=(.*)$/gmu;

    for (const environment of [web, collector]) {
      for (const match of environment.matchAll(secretAssignments)) expect(match[1]).toBe('');
      expect(environment).not.toMatch(
        /(?:postgres(?:ql)?:\/\/|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)/iu
      );
    }
  });

  it('contains no source-checkout path in canonical service or environment assets', async () => {
    const artifacts = [
      ...(await Promise.all(Object.keys(services).map(unit))),
      await readFile(new URL('edutrack-ops-collector-failed@.service', systemdDirectory), 'utf8'),
      await readFile(new URL('web.env.example', environmentDirectory), 'utf8'),
      await readFile(new URL('collector.env.example', environmentDirectory), 'utf8')
    ].join('\n');

    expect(artifacts).not.toMatch(/\/home\/|ops-console\/dist|\/srv\/edutrack\/current/iu);
  });
});
