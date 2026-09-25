#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/../.." && pwd)"
readonly COMPOSE_FILE="${REPOSITORY_ROOT}/deploy/postgres/database-explorer-test.compose.yaml"
readonly INIT_SQL="${REPOSITORY_ROOT}/deploy/postgres/database-explorer-test-init.sql"
readonly FIXTURE_SQL="${REPOSITORY_ROOT}/deploy/postgres/database-explorer-test-fixtures.sql"
readonly PG16_BIN="${PG16_BIN:-/usr/lib/postgresql/16/bin}"
readonly TARGETS=(edutrack_production ops)
readonly TARGET_SERVICES=(postgres-edutrack postgres-ops)
readonly TARGET_LOGINS=(ops_browser_edutrack ops_browser_ops)
readonly TARGET_DATABASES=(edutrack_production edutrack_ops)

TEMP_ROOT=''
RUNTIME=''
COMPOSE_PROJECT=''
COMPOSE_COMMAND=()
declare -a PG_DATA=()
declare -a PG_LOGS=()
declare -a PG_PORTS=()

fail() {
  printf 'database-explorer-postgres: %s\n' "$1" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

create_port() {
  node --input-type=module -e '
    import { createServer } from "node:net";
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") process.exit(2);
      process.stdout.write(String(address.port));
      server.close();
    });
  '
}

stop_native_clusters() {
  local index
  for index in "${!PG_DATA[@]}"; do
    if [ -f "${PG_DATA[$index]}/PG_VERSION" ]; then
      "$PG16_BIN/pg_ctl" -D "${PG_DATA[$index]}" -m fast -w stop >/dev/null 2>&1 || true
    fi
  done
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$RUNTIME" = compose ] && [ -n "$COMPOSE_PROJECT" ]; then
    DATABASE_EXPLORER_TEST_ROOT="$TEMP_ROOT" \
      DATABASE_EXPLORER_TEST_PROJECT="$COMPOSE_PROJECT" \
      "${COMPOSE_COMMAND[@]}" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
  elif [ "$RUNTIME" = native ]; then
    stop_native_clusters
  fi
  if [ -n "$TEMP_ROOT" ] && [[ "$TEMP_ROOT" == "${TMPDIR:-/tmp}"/edx-database-explorer.* ]]; then
    rm -rf -- "$TEMP_ROOT"
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command openssl
require_command node
require_command npm
require_command psql
[ -x "${REPOSITORY_ROOT}/node_modules/.bin/vitest" ] || fail 'repo dependencies are not installed: node_modules/.bin/vitest is missing'

NATIVE_AVAILABLE=true
for executable in initdb postgres pg_ctl pg_isready; do
  if [ ! -x "${PG16_BIN}/${executable}" ]; then NATIVE_AVAILABLE=false; fi
done
if [ "$NATIVE_AVAILABLE" = true ]; then
  postgres_version="$("$PG16_BIN/postgres" --version)"
  [[ "$postgres_version" =~ PostgreSQL\)\ 16\. ]] || NATIVE_AVAILABLE=false
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_COMMAND=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    COMPOSE_COMMAND=(docker-compose)
  fi
fi

if [ "${#COMPOSE_COMMAND[@]}" -gt 0 ]; then
  RUNTIME=compose
elif [ "$NATIVE_AVAILABLE" = true ]; then
  RUNTIME=native
else
  fail "neither Docker Compose nor PostgreSQL 16 native prerequisites are available (expected ${PG16_BIN}/initdb, postgres, pg_ctl, pg_isready)"
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/edx-database-explorer.XXXXXX")"
chmod 0700 "$TEMP_ROOT"
mkdir -m 0700 "$TEMP_ROOT/certs" "$TEMP_ROOT/secrets" "$TEMP_ROOT/clusters" "$TEMP_ROOT/sockets"
openssl rand -hex 8 > "$TEMP_ROOT/secrets/admin.password"
openssl rand -hex 24 > "$TEMP_ROOT/secrets/browser-edutrack.password"
openssl rand -hex 24 > "$TEMP_ROOT/secrets/browser-ops.password"
openssl rand -hex 32 > "$TEMP_ROOT/secrets/worker-hmac"
openssl rand -base64 32 | tr -d '\r\n' > "$TEMP_ROOT/secrets/cursor-key"
chmod 0600 "$TEMP_ROOT/secrets/"*

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TEMP_ROOT/certs/ca.key" \
  -out "$TEMP_ROOT/certs/ca.crt" \
  -sha256 -days 2 -subj '/CN=Database Explorer Ephemeral Test CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$TEMP_ROOT/certs/server.key" \
  -out "$TEMP_ROOT/certs/server.csr" \
  -sha256 -subj '/CN=localhost'
cat > "$TEMP_ROOT/certs/server-ext.cnf" <<'EOF'
[server_cert]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names
[alt_names]
DNS.1=localhost
DNS.2=postgres-edutrack
DNS.3=postgres-ops
IP.1=127.0.0.1
EOF
openssl x509 -req -in "$TEMP_ROOT/certs/server.csr" \
  -CA "$TEMP_ROOT/certs/ca.crt" -CAkey "$TEMP_ROOT/certs/ca.key" -CAcreateserial \
  -out "$TEMP_ROOT/certs/server.crt" -days 2 -sha256 \
  -extfile "$TEMP_ROOT/certs/server-ext.cnf" -extensions server_cert >/dev/null 2>&1
openssl verify -CAfile "$TEMP_ROOT/certs/ca.crt" "$TEMP_ROOT/certs/server.crt" >/dev/null \
  || fail 'generated PostgreSQL server certificate did not verify against the temporary CA'
chmod 0600 "$TEMP_ROOT/certs/ca.key" "$TEMP_ROOT/certs/server.key" "$TEMP_ROOT/certs/server.csr" "$TEMP_ROOT/certs/ca.srl" 2>/dev/null || true
chmod 0644 "$TEMP_ROOT/certs/ca.crt" "$TEMP_ROOT/certs/server.crt"

create_admin_pgpass() {
  local port="$1"
  local output="$2"
  printf '127.0.0.1:%s:*:postgres:' "$port" > "$output"
  tr -d '\r\n' < "$TEMP_ROOT/secrets/admin.password" >> "$output"
  printf '\n' >> "$output"
  chmod 0600 "$output"
}

if [ "$RUNTIME" = compose ]; then
  COMPOSE_PROJECT="edx-explorer-$(openssl rand -hex 8)"
  cp "$INIT_SQL" "$TEMP_ROOT/database-explorer-test-init.sql"
  cp "$FIXTURE_SQL" "$TEMP_ROOT/database-explorer-test-fixtures.sql"
  chmod 0600 "$TEMP_ROOT/database-explorer-test-init.sql" "$TEMP_ROOT/database-explorer-test-fixtures.sql"
  export DATABASE_EXPLORER_TEST_ROOT="$TEMP_ROOT"
  export DATABASE_EXPLORER_TEST_PROJECT="$COMPOSE_PROJECT"
  "${COMPOSE_COMMAND[@]}" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" config -q \
    || fail 'Docker Compose rejected the ephemeral PostgreSQL fixture configuration'
  "${COMPOSE_COMMAND[@]}" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d \
    || fail 'Docker Compose could not start the isolated PostgreSQL 16 fixture'

  for index in 0 1; do
    service="${TARGET_SERVICES[$index]}"
    ready=false
    for attempt in $(seq 1 60); do
      if "${COMPOSE_COMMAND[@]}" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" \
        exec -T "$service" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
        ready=true
        break
      fi
      sleep 1
    done
    [ "$ready" = true ] || fail "PostgreSQL service is not ready: $service"
    port_output="$("${COMPOSE_COMMAND[@]}" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" port "$service" 5432)"
    PG_PORTS[$index]="${port_output##*:}"
    create_admin_pgpass "${PG_PORTS[$index]}" "$TEMP_ROOT/secrets/admin-${TARGETS[$index]}.pgpass"
  done
else
  for index in 0 1; do
    target="${TARGETS[$index]}"
    data_directory="$TEMP_ROOT/clusters/$target/data"
    socket_directory="$TEMP_ROOT/sockets/$target"
    log_file="$TEMP_ROOT/clusters/$target/postgres.log"
    mkdir -m 0700 -p "$(dirname "$data_directory")" "$socket_directory"
    chmod 0700 "$socket_directory"
    port="$(create_port)"
    PG_PORTS[$index]="$port"
    PG_DATA[$index]="$data_directory"
    PG_LOGS[$index]="$log_file"
    "$PG16_BIN/initdb" -D "$data_directory" --username=postgres \
      --pwfile="$TEMP_ROOT/secrets/admin.password" \
      --auth-local=trust --auth-host=scram-sha-256 --data-checksums \
      --encoding=UTF8 >/dev/null
    chmod 0700 "$data_directory"
    "$PG16_BIN/pg_ctl" -D "$data_directory" -l "$log_file" \
      -o "-p $port -h 127.0.0.1 -c unix_socket_directories=$socket_directory -c ssl=on -c ssl_ca_file=$TEMP_ROOT/certs/ca.crt -c ssl_cert_file=$TEMP_ROOT/certs/server.crt -c ssl_key_file=$TEMP_ROOT/certs/server.key -c log_statement=none -c log_min_error_statement=panic -c log_connections=off -c log_disconnections=off" \
      -w start >/dev/null
    create_admin_pgpass "$port" "$TEMP_ROOT/secrets/admin-${target}.pgpass"
    target_login="${TARGET_LOGINS[$index]}"
    create_existing_login=off
    if [ "$index" = 0 ]; then create_existing_login=on; fi
    DATABASE_EXPLORER_TEST_TARGET="$target" \
      DATABASE_EXPLORER_TEST_LOGIN="$target_login" \
      DATABASE_EXPLORER_TEST_CREATE_EXISTING_LOGIN="$create_existing_login" \
      DATABASE_EXPLORER_TEST_FIXTURE_SCRIPT="$FIXTURE_SQL" \
      PGHOST="$socket_directory" PGPORT="$port" PGUSER=postgres \
      psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname=postgres --file="$INIT_SQL" \
      || fail "PostgreSQL 16 fixture initialization failed for target: $target"
  done
fi

for index in 0 1; do
  target="${TARGETS[$index]}"
  login="${TARGET_LOGINS[$index]}"
  port="${PG_PORTS[$index]}"
  pass_file="$TEMP_ROOT/secrets/browser-edutrack.password"
  if [ "$target" = ops ]; then pass_file="$TEMP_ROOT/secrets/browser-ops.password"; fi
  printf '127.0.0.1:%s:*:%s:' "$port" "$login" > "$TEMP_ROOT/secrets/browser-${target}.pgpass"
  tr -d '\r\n' < "$pass_file" >> "$TEMP_ROOT/secrets/browser-${target}.pgpass"
  printf '\n' >> "$TEMP_ROOT/secrets/browser-${target}.pgpass"
  chmod 0600 "$TEMP_ROOT/secrets/browser-${target}.pgpass"
done

DATABASE_EXPLORER_TEST_ROOT="$TEMP_ROOT" \
DATABASE_EXPLORER_TEST_RUNTIME="$RUNTIME" \
DATABASE_EXPLORER_TEST_PROJECT="$COMPOSE_PROJECT" \
DATABASE_EXPLORER_TEST_COMPOSE_FILE="$COMPOSE_FILE" \
DATABASE_EXPLORER_TEST_PORTS="${PG_PORTS[0]},${PG_PORTS[1]}" \
DATABASE_EXPLORER_TEST_DATA="${PG_DATA[0]:-},${PG_DATA[1]:-}" \
DATABASE_EXPLORER_TEST_LOGS="${PG_LOGS[0]:-},${PG_LOGS[1]:-}" \
DATABASE_EXPLORER_TEST_SERVICES="${TARGET_SERVICES[0]},${TARGET_SERVICES[1]}" \
DATABASE_EXPLORER_TEST_COMPOSE_COMMAND="${COMPOSE_COMMAND[*]}" \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.DATABASE_EXPLORER_TEST_ROOT;
const runtime = process.env.DATABASE_EXPLORER_TEST_RUNTIME;
const targets = ['edutrack_production', 'ops'];
const databases = ['edutrack_production', 'edutrack_ops'];
const logins = ['ops_browser_edutrack', 'ops_browser_ops'];
const ports = process.env.DATABASE_EXPLORER_TEST_PORTS.split(',').map(Number);
const dataDirectories = process.env.DATABASE_EXPLORER_TEST_DATA.split(',');
const logs = process.env.DATABASE_EXPLORER_TEST_LOGS.split(',');
const services = process.env.DATABASE_EXPLORER_TEST_SERVICES.split(',');
const readSecret = (path) => readFileSync(path, 'utf8').trim();
const caFile = join(root, 'certs', 'ca.crt');
const adminPassword = readSecret(join(root, 'secrets', 'admin.password'));
const workerHmac = readSecret(join(root, 'secrets', 'worker-hmac'));
const cursorKey = readSecret(join(root, 'secrets', 'cursor-key'));
const targetConfigs = {};

for (let index = 0; index < targets.length; index += 1) {
  const targetId = targets[index];
  const login = logins[index];
  const databaseName = databases[index];
  const browserPasswordFile = join(
    root,
    'secrets',
    targetId === 'ops' ? 'browser-ops.password' : 'browser-edutrack.password'
  );
  const browserPassword = readSecret(browserPasswordFile);
  const makeUrl = (user, password, database) => {
    const url = new URL('postgresql://127.0.0.1');
    url.username = user;
    url.password = password;
    url.port = String(ports[index]);
    url.pathname = `/${database}`;
    url.searchParams.set('sslmode', 'verify-full');
    url.searchParams.set('sslrootcert', caFile);
    return url.toString();
  };
  const browserUrl = makeUrl(login, browserPassword, databaseName);
  const browserDatabaseUrlFile = join(root, 'secrets', `browser-${targetId}.database-url`);
  writeFileSync(browserDatabaseUrlFile, `${browserUrl}\n`, { mode: 0o600, flag: 'wx' });
  targetConfigs[targetId] = {
    targetId,
    login,
    databaseName,
    marker: targetId === 'ops' ? 'ops' : 'edutrack_production',
    host: '127.0.0.1',
    port: ports[index],
    browserUrl,
    browserDatabaseUrlFile,
    browserPasswordFile,
    browserPgpassFile: join(root, 'secrets', `browser-${targetId}.pgpass`),
    adminUrl: makeUrl('postgres', adminPassword, databaseName),
    adminPgpassFile: join(root, 'secrets', `admin-${targetId}.pgpass`),
    ...(runtime === 'native'
      ? {
          dataDirectory: dataDirectories[index],
          logFile: logs[index],
          socketDirectory: join(root, 'sockets', targetId),
          pgCtl: '/usr/lib/postgresql/16/bin/pg_ctl',
          caFile,
          serverCertFile: join(root, 'certs', 'server.crt'),
          serverKeyFile: join(root, 'certs', 'server.key')
        }
      : {
          service: services[index],
          project: process.env.DATABASE_EXPLORER_TEST_PROJECT,
          composeFile: process.env.DATABASE_EXPLORER_TEST_COMPOSE_FILE,
          composeCommand: process.env.DATABASE_EXPLORER_TEST_COMPOSE_COMMAND
        })
  };
}

const config = {
  runtime,
  tempRoot: root,
  caFile,
  hmacSecret: workerHmac,
  cursorKey,
  policyVersion: '2026-09-25-v2',
  schemaOwnerRole: 'explorer_fixture_owner',
  creatorRole: 'explorer_unapproved_creator',
  fixtureSchema: 'public',
  fixtureRelation: 'explorer_rows',
  safeColumn: 'safe_value',
  blockedColumn: 'blocked_token',
  targets: targetConfigs
};
writeFileSync(join(root, 'database-explorer-postgres.json'), `${JSON.stringify(config)}\n`, {
  mode: 0o600,
  flag: 'wx'
});
NODE

CONFIG_FILE="$TEMP_ROOT/database-explorer-postgres.json"
[ "$(stat -c '%a' "$CONFIG_FILE")" = 600 ] || fail 'fixture credential/config file must have mode 0600'

for index in 0 1; do
  target="${TARGETS[$index]}"
  port="${PG_PORTS[$index]}"
  pgpass="$TEMP_ROOT/secrets/admin-${target}.pgpass"
  for attempt in $(seq 1 30); do
    if PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres PGPASSFILE="$pgpass" \
      PGSSLMODE=verify-full PGSSLROOTCERT="$TEMP_ROOT/certs/ca.crt" PGCONNECT_TIMEOUT=3 \
      psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --dbname=postgres --command='SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()' | rg -qx t; then
      break
    fi
    if [ "$attempt" = 30 ]; then fail "PostgreSQL verify-full TLS readiness failed for target: $target"; fi
    sleep 1
  done
  for database in edutrack_production edutrack_ops; do
    exists="$(PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres PGPASSFILE="$pgpass" \
      PGSSLMODE=verify-full PGSSLROOTCERT="$TEMP_ROOT/certs/ca.crt" \
      psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --dbname=postgres --command="SELECT count(*) FROM pg_database WHERE datname = '$database'")"
    [ "$exists" = 1 ] || fail "expected ephemeral database is missing: $database on $target"
  done
done

DATABASE_EXPLORER_TEST_CONFIG="$CONFIG_FILE" \
  npm exec -- vitest run --config "$REPOSITORY_ROOT/vitest.database-explorer.integration.config.ts" --reporter=verbose "$@"
