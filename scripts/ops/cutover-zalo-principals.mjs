import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_USERNAMES = Object.freeze(['tuan.dev', 'ops-admin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ZALO_TABLES = Object.freeze(['zalo_link_codes', 'zalo_links', 'zalo_webhook_events']);

function fail(code) {
  throw new Error(code);
}

function normalizeMappings(mappings) {
  if (!Array.isArray(mappings) || mappings.length !== REQUIRED_USERNAMES.length)
    fail('OPS_ZALO_CUTOVER_MAPPING_INVALID');
  const byUsername = new Map();
  for (const mapping of mappings) {
    if (
      !mapping ||
      typeof mapping.username !== 'string' ||
      typeof mapping.principalId !== 'string' ||
      !UUID_PATTERN.test(mapping.principalId) ||
      byUsername.has(mapping.username)
    )
      fail('OPS_ZALO_CUTOVER_MAPPING_INVALID');
    byUsername.set(mapping.username, mapping.principalId);
  }
  if (REQUIRED_USERNAMES.some((username) => !byUsername.has(username)))
    fail('OPS_ZALO_CUTOVER_MAPPING_INVALID');
  const principalIds = [...byUsername.values()];
  if (new Set(principalIds).size !== principalIds.length)
    fail('OPS_ZALO_CUTOVER_MAPPING_INVALID');
  return byUsername;
}

function tableHasPrincipalId(database, table) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((column) => column.name === 'principal_id');
}

function updatePrincipalReferences(database, table, replacements) {
  const result = database
    .prepare(
      `UPDATE ${table}
       SET principal_id = CASE principal_id WHEN ? THEN ? WHEN ? THEN ? END
       WHERE principal_id IN (?, ?)`
    )
    .run(
      replacements[0].legacyId,
      replacements[0].principalId,
      replacements[1].legacyId,
      replacements[1].principalId,
      replacements[0].legacyId,
      replacements[1].legacyId
    );
  return result.changes;
}

function assertNoUnmappedReferences(database, allowedPrincipalIds) {
  const placeholders = allowedPrincipalIds.map(() => '?').join(', ');
  for (const table of ZALO_TABLES) {
    const row = database
      .prepare(
        `SELECT 1 FROM ${table}
         WHERE principal_id NOT IN (${placeholders}) LIMIT 1`
      )
      .get(...allowedPrincipalIds);
    if (row) fail('OPS_ZALO_CUTOVER_UNMAPPED_PRINCIPAL');
  }
}

export function cutoverZaloPrincipals({ databasePath, mappings }) {
  if (typeof databasePath !== 'string' || !databasePath) fail('OPS_ZALO_CUTOVER_DATABASE_INVALID');
  const byUsername = normalizeMappings(mappings);
  const database = new Database(databasePath);
  database.pragma('busy_timeout = 5000');
  try {
    database.exec('BEGIN IMMEDIATE');
    const version = database.prepare('SELECT version FROM schema_version LIMIT 1').get();
    if (version?.version !== 4) fail('OPS_ZALO_CUTOVER_SCHEMA_INVALID');
    if (ZALO_TABLES.some((table) => !tableHasPrincipalId(database, table)))
      fail('OPS_ZALO_CUTOVER_SCHEMA_INVALID');

    const replacements = REQUIRED_USERNAMES.map((username) => {
      const account = database
        .prepare('SELECT id FROM accounts WHERE username = ? LIMIT 1')
        .get(username);
      if (!account?.id) fail('OPS_ZALO_CUTOVER_ACCOUNT_MISSING');
      const principalId = byUsername.get(username);
      if (!principalId || principalId === account.id) fail('OPS_ZALO_CUTOVER_MAPPING_INVALID');
      return { legacyId: account.id, principalId };
    });
    if (new Set(replacements.map(({ legacyId }) => legacyId)).size !== replacements.length)
      fail('OPS_ZALO_CUTOVER_ACCOUNT_INVALID');

    const counts = {
      linkCodes: updatePrincipalReferences(database, 'zalo_link_codes', replacements),
      links: updatePrincipalReferences(database, 'zalo_links', replacements),
      webhookEvents: updatePrincipalReferences(database, 'zalo_webhook_events', replacements)
    };
    assertNoUnmappedReferences(
      database,
      replacements.map(({ principalId }) => principalId)
    );
    database.exec('COMMIT');
    return counts;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the original cutover failure.
    }
    throw error;
  } finally {
    database.close();
  }
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !['--database', '--tuan-dev-principal-id', '--ops-admin-principal-id'].includes(key) ||
      !value ||
      values.has(key)
    )
      fail('OPS_ZALO_CUTOVER_USAGE');
    values.set(key, value);
    index += 1;
  }
  if (values.size !== 3) fail('OPS_ZALO_CUTOVER_USAGE');
  return {
    databasePath: values.get('--database'),
    mappings: [
      { username: 'tuan.dev', principalId: values.get('--tuan-dev-principal-id') },
      { username: 'ops-admin', principalId: values.get('--ops-admin-principal-id') }
    ]
  };
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  try {
    const result = cutoverZaloPrincipals(parseArguments(process.argv.slice(2)));
    process.stdout.write(
      `Zalo principal cutover complete: link_codes=${result.linkCodes} links=${result.links} webhook_events=${result.webhookEvents}\n`
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : 'OPS_ZALO_CUTOVER_FAILED';
    process.stderr.write(`${/^OPS_ZALO_CUTOVER_[A-Z_]+$/u.test(code) ? code : 'OPS_ZALO_CUTOVER_FAILED'}\n`);
    process.exitCode = 1;
  }
}
