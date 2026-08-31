import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parseCatalog } from '../../packages/config-contracts/src/catalog.js';
import { runCatalogCoverage, scanRepositoryReferences } from './catalogCoverage.js';

const tempRoots: string[] = [];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

async function createFixtureRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('scanRepositoryReferences', () => {
  it('collects supported name-only reference patterns without leaking values', async () => {
    const repoRoot = await createFixtureRoot('edutrack-platform-fixture-');
    await writeText(
      join(repoRoot, 'server/runtime.ts'),
      [
        "const REQUIRED = ['SESSION_SECRET'];",
        'const missing = REQUIRED.filter((name) => !process.env[name]);',
        "const url = process.env['DATABASE_URL'];",
        'const publicOrigin = import.meta.env.VITE_PUBLIC_BASE_URL;',
        "const config = { env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000' } };"
      ].join('\n')
    );
    await writeText(
      join(repoRoot, 'deploy/systemd/app.service'),
      [
        'EnvironmentFile=/etc/example/app.env',
        'LoadCredential=app-secret:/etc/example/credentials/app-secret'
      ].join('\n')
    );
    await writeText(
      join(repoRoot, 'deploy/jobs/nightly.mjs'),
      "export const nightly = { schedule: '0 * * * *', env: { CRON_SECRET: 'DO_NOT_LEAK_VALUE_7J9K' } };"
    );

    const report = await scanRepositoryReferences({ repoRoot });

    expect(report.names).toEqual(
      expect.arrayContaining([
        'CRON_SECRET',
        'DATABASE_URL',
        'HOST',
        'NODE_ENV',
        'PORT',
        'SESSION_SECRET',
        'VITE_PUBLIC_BASE_URL'
      ])
    );
    expect(report.requiredNames).toContain('SESSION_SECRET');
    expect(report.manualReview).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('DO_NOT_LEAK_VALUE_7J9K');
    expect(JSON.stringify(report)).not.toContain('CRON_SECRET=DO_NOT_LEAK_VALUE_7J9K');
  });

  it('raises a manual-review finding for dynamic environment-key access', async () => {
    const repoRoot = await createFixtureRoot('edutrack-ops-fixture-');
    await writeText(
      join(repoRoot, 'apps/api/runtime.ts'),
      ['const value = process.env[runtimeName()];', 'export { value };'].join('\n')
    );

    const report = await scanRepositoryReferences({ repoRoot });

    expect(report.manualReview).toHaveLength(1);
    expect(report.manualReview[0]).toContain('apps/api/runtime.ts');
  });
});

describe('runCatalogCoverage', () => {
  it('reports cataloged, unknown, missing, and stale sets without values', async () => {
    const fixtureRoot = await createFixtureRoot('catalog-coverage-');
    const sourceRoot = join(fixtureRoot, 'sources');
    const repoRoot = join(fixtureRoot, 'edutrack-platform');
    const catalogPath = join(fixtureRoot, 'catalog.yaml');
    const manifestPath = join(fixtureRoot, 'manifest.yaml');

    await writeText(
      join(sourceRoot, 'shared.env'),
      ['DATABASE_URL=DO_NOT_LEAK_VALUE_7J9K', 'NEW_VENDOR_FLAG=DO_NOT_LEAK_VALUE_7J9K'].join('\n')
    );
    await writeText(
      join(repoRoot, 'server/runtime.ts'),
      [
        "const REQUIRED = ['SESSION_SECRET'];",
        'const missing = REQUIRED.filter((name) => !process.env[name]);',
        "const url = process.env['DATABASE_URL'];"
      ].join('\n')
    );
    await writeText(
      catalogPath,
      [
        'catalogVersion: 2026-08-31',
        'apps:',
        '  - id: edutrack',
        '    displayName: EduTrack Platform',
        '    runtimeVariableCount: 2',
        '  - id: website',
        '    displayName: Thien Uy Website',
        '    runtimeVariableCount: 0',
        'entries:',
        '  - id: edutrack.database_url',
        '    name: DATABASE_URL',
        '    appId: edutrack',
        '    sourceId: edutrack.shared_env',
        '    consumerIds: [edutrack.web]',
        '    category: database',
        '    description: Primary database URL',
        '    sensitivity: secret',
        '    requirement: required',
        '    mutability: managed',
        '    applyStrategy: runtime_restart',
        '    validatorId: postgres_url',
        '    precedenceId: env_file',
        '  - id: edutrack.removed_toggle',
        '    name: REMOVED_TOGGLE',
        '    appId: edutrack',
        '    sourceId: edutrack.shared_env',
        '    consumerIds: [edutrack.web]',
        '    category: feature_flags',
        '    description: Removed feature flag',
        '    sensitivity: internal',
        '    requirement: optional',
        '    mutability: managed',
        '    applyStrategy: runtime_restart',
        '    precedenceId: env_file',
        'validators:',
        '  - id: postgres_url',
        '    type: url',
        '    allowedSchemes: [postgres, postgresql]',
        'consumers:',
        '  - id: edutrack.web',
        '    appId: edutrack',
        '    kind: service',
        '    displayName: EduTrack Web',
        'precedences:',
        '  - id: env_file',
        '    rank: 200',
        '    scope: runtime',
        '    description: Env file precedence'
      ].join('\n')
    );
    const digest = `sha256:${createHash('sha256')
      .update(
        `${JSON.stringify(canonicalize(parseCatalog(await readFile(catalogPath, 'utf8'))))}\n`
      )
      .digest('hex')}`;
    await writeText(
      manifestPath,
      [
        'manifestVersion: 2026-08-31',
        'catalogVersion: 2026-08-31',
        `catalogDigest: ${digest}`,
        'readOnly: true',
        'apps:',
        '  - id: edutrack',
        '    displayName: EduTrack Platform',
        '    sourceIds: [edutrack.shared_env]',
        '  - id: website',
        '    displayName: Thien Uy Website',
        '    sourceIds: []',
        'sources:',
        '  - id: edutrack.shared_env',
        '    appId: edutrack',
        '    pathLabel: shared.env',
        '    adapterId: node_env_file',
        '    mutability: catalog_controlled',
        '    locator:',
        '      kind: file',
        `      path: ${join(sourceRoot, 'shared.env')}`,
        '    owner: deploy',
        '    group: deploy',
        '    mode: "0640"',
        '    maximumBytes: 1024',
        '    precedenceRank: 200',
        'actions: []',
        'checks: []'
      ].join('\n')
    );

    const report = await runCatalogCoverage({
      manifestPath,
      catalogPath,
      repoRoots: [repoRoot]
    });

    expect(report.catalogedActive).toContain('edutrack.database_url');
    expect(report.unknownActive).toContain('edutrack.new_vendor_flag');
    expect(report.missingRequired).toContain('edutrack.session_secret');
    expect(report.staleCatalog).toContain('edutrack.removed_toggle');
    expect(JSON.stringify(report)).not.toContain('DO_NOT_LEAK_VALUE_7J9K');
    expect(JSON.stringify(report)).not.toContain('DATABASE_URL=DO_NOT_LEAK_VALUE_7J9K');
  });
});
