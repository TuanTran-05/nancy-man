import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const runnerPath = join(repositoryRoot, 'scripts/database-explorer/run-postgres-integration.sh');

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o700 });
  await chmod(path, 0o700);
}

async function createRunnerHarness(runtime: 'compose' | 'native') {
  const directory = await mkdtemp(join(tmpdir(), 'database-explorer-runner-test-'));
  const binDirectory = join(directory, 'bin');
  const pg16Directory = join(directory, 'postgres-16');
  const tempDirectory = join(directory, 'tmp');
  const eventsPath = join(directory, 'pg-ctl-events');
  const startCountPath = join(directory, 'pg-ctl-start-count');
  const portCountPath = join(directory, 'port-count');
  const composeCheckPath = join(directory, 'compose-config-checked');
  await Promise.all([
    mkdir(binDirectory, { mode: 0o700 }),
    mkdir(pg16Directory, { mode: 0o700 }),
    mkdir(tempDirectory, { mode: 0o700 }),
    writeFile(eventsPath, ''),
    writeFile(startCountPath, '0\n'),
    writeFile(portCountPath, '0\n')
  ]);

  const composeDocker = String.raw`#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = info ]; then exit 0; fi
if [ "$1" != compose ]; then exit 1; fi
shift
if [ "$1" = version ]; then exit 0; fi
case " $* " in
  *' config -q '*)
    fixture_root="$DATABASE_EXPLORER_TEST_ROOT"
    [ "$(stat -c '%a' "$fixture_root")" = 700 ]
    [ "$(stat -c '%a' "$fixture_root/database-explorer-test-init.sql")" = 644 ]
    [ "$(stat -c '%a' "$fixture_root/database-explorer-test-fixtures.sql")" = 644 ]
    [ "$(stat -c '%a' "$fixture_root/secrets/admin.password")" = 600 ]
    [ "$(stat -c '%a' "$fixture_root/certs/server.key")" = 600 ]
    printf 'checked\n' > "$FAKE_COMPOSE_CONFIG_CHECK"
    ;;
  *' exec -T '*) exit 0 ;;
  *' port postgres-edutrack 5432'*) printf '127.0.0.1:43111\n' ;;
  *' port postgres-ops 5432'*) printf '127.0.0.1:43112\n' ;;
  *' down --remove-orphans'*) exit 0 ;;
  *' up -d'*) exit 0 ;;
  *) printf 'unexpected mocked compose call\n' >&2; exit 1 ;;
esac
`;
  await writeExecutable(
    join(binDirectory, 'docker'),
    runtime === 'compose'
      ? composeDocker
      : String.raw`#!/usr/bin/env bash
exit 1
`
  );
  await writeExecutable(
    join(binDirectory, 'node'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ge 2 ] && [ "$1" = --input-type=module ] && [ "$2" = -e ]; then
  read -r count < "$FAKE_PORT_COUNT"
  count=$((count + 1))
  printf '%s\n' "$count" > "$FAKE_PORT_COUNT"
  case "$count" in
    1) printf '43111\n' ;;
    2) printf '43112\n' ;;
    3) printf '43113\n' ;;
    *) printf '43114\n' ;;
  esac
  exit 0
fi
exec "$REAL_NODE" "$@"
`
  );
  await writeExecutable(
    join(binDirectory, 'psql'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *'SELECT ssl FROM pg_stat_ssl'*) printf 't\n' ;;
  *'SELECT count(*) FROM pg_database'*) printf '1\n' ;;
esac
`
  );
  await writeExecutable(
    join(binDirectory, 'npm'),
    String.raw`#!/usr/bin/env bash
exit 0
`
  );

  if (runtime === 'native') {
    await writeExecutable(
      join(pg16Directory, 'initdb'),
      String.raw`#!/usr/bin/env bash
set -euo pipefail
while [ "$#" -gt 0 ]; do
  if [ "$1" = -D ]; then data_directory="$2"; shift 2; else shift; fi
done
mkdir -p "$data_directory"
printf '16\n' > "$data_directory/PG_VERSION"
`
    );
    await writeExecutable(
      join(pg16Directory, 'postgres'),
      String.raw`#!/usr/bin/env bash
printf 'postgres (PostgreSQL) 16.14\n'
`
    );
    await writeExecutable(
      join(pg16Directory, 'pg_isready'),
      String.raw`#!/usr/bin/env bash
exit 0
`
    );
    await writeExecutable(
      join(pg16Directory, 'pg_ctl'),
      String.raw`#!/usr/bin/env bash
set -euo pipefail
data_directory=''
log_file=''
options=''
operation=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -D) data_directory="$2"; shift 2 ;;
    -l) log_file="$2"; shift 2 ;;
    -o) options="$2"; shift 2 ;;
    -m) shift 2 ;;
    start|stop) operation="$1"; shift ;;
    *) shift ;;
  esac
done
if [ "$operation" = start ]; then
  read -r flag port rest <<< "$options"
  read -r count < "$FAKE_PG_CTL_START_COUNT"
  count=$((count + 1))
  printf '%s\n' "$count" > "$FAKE_PG_CTL_START_COUNT"
  printf 'start\t%s\t%s\n' "$data_directory" "$port" >> "$FAKE_PG_CTL_EVENTS"
  if [ "$FAKE_BIND_CONFLICT_ONCE" = 1 ] && [ "$count" = 1 ]; then
    printf 'could not bind IPv4 address "127.0.0.1": Address already in use\n' >> "$log_file"
    printf 'FATAL: could not create any TCP/IP sockets\n' >> "$log_file"
    exit 1
  fi
  printf 'server started\n' >> "$log_file"
  touch "$data_directory/running"
  exit 0
fi
if [ "$operation" = stop ]; then
  printf 'stop\t%s\n' "$data_directory" >> "$FAKE_PG_CTL_EVENTS"
  rm -f "$data_directory/running"
  exit 0
fi
exit 2
`
    );
  }

  const environment = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
    TMPDIR: tempDirectory,
    REAL_NODE: process.execPath,
    FAKE_COMPOSE_CONFIG_CHECK: composeCheckPath,
    FAKE_PG_CTL_EVENTS: eventsPath,
    FAKE_PG_CTL_START_COUNT: startCountPath,
    FAKE_PORT_COUNT: portCountPath,
    FAKE_BIND_CONFLICT_ONCE: runtime === 'native' ? '1' : '0',
    ...(runtime === 'native' ? { PG16_BIN: pg16Directory } : {})
  };
  return { directory, eventsPath, composeCheckPath, environment };
}

function runFixtureRunner(environment: NodeJS.ProcessEnv) {
  return spawnSync('bash', [runnerPath], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 90_000
  });
}

describe('PostgreSQL integration fixture runner', () => {
  it('stages Compose SQL readable to the container while keeping the secret boundary private', async () => {
    const harness = await createRunnerHarness('compose');
    try {
      const result = runFixtureRunner(harness.environment);

      expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
      expect(await readFile(harness.composeCheckPath, 'utf8')).toBe('checked\n');
    } finally {
      await rm(harness.directory, { recursive: true, force: true });
    }
  }, 100_000);

  it('reselects a temporary port after a native bind conflict and cleans only its own clusters', async () => {
    const harness = await createRunnerHarness('native');
    try {
      const result = runFixtureRunner(harness.environment);

      expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
      const events = (await readFile(harness.eventsPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => line.split('\t'));
      const starts = events.filter(([kind]) => kind === 'start');
      expect(starts.map(([, , port]) => port)).toEqual(['43111', '43112', '43113']);
      expect(starts[0]?.[1]).toBe(starts[1]?.[1]);
      expect(starts[1]?.[1]).not.toBe(starts[2]?.[1]);
      expect(events.slice(0, 3).map(([kind]) => kind)).toEqual(['start', 'stop', 'start']);
      expect(
        events
          .filter(([kind]) => kind === 'stop')
          .every(([, dataDirectory]) =>
            dataDirectory?.startsWith(
              `${String(harness.environment.TMPDIR)}/edx-database-explorer.`
            )
          )
      ).toBe(true);
    } finally {
      await rm(harness.directory, { recursive: true, force: true });
    }
  }, 100_000);
});
