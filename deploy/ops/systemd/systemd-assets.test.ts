import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

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
    executable: '/usr/bin/node apps/web/dist/server/web-entry.js',
    user: 'edutrack-ops-web',
    group: 'edutrack-ops-shared',
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
  it('defines exactly the seven least-privilege service identities and entrypoints', async () => {
    expect(Object.keys(services)).toHaveLength(7);

    for (const [name, expected] of Object.entries(services)) {
      const contents = await unit(name);
      expect(setting(contents, 'User')).toEqual([expected.user]);
      expect(setting(contents, 'Group')).toEqual([expected.group]);
      expect(setting(contents, 'WorkingDirectory')).toEqual(['/srv/edutrack-ops/current']);
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

  it('gives only the API and SQL worker identities group-level access to the private socket', async () => {
    const api = await unit('api');
    const worker = await unit('sql-worker');
    const socketGroup = 'edutrack-ops-sql';

    expect(setting(api, 'SupplementaryGroups')).toEqual([socketGroup]);
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
