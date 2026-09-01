import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  canonicalCatalogDigest,
  loadCatalogAndManifest,
  ManifestLoadError
} from './manifestLoader.js';

const catalogPath = join(process.cwd(), 'config/variables/catalog.yaml');
const manifestPath = join(process.cwd(), 'deploy/ops/config-agent/manifest.yaml');

describe('loadCatalogAndManifest', () => {
  test('binds the strict catalog to its root-owned manifest before source reads', () => {
    const loaded = loadCatalogAndManifest({ catalogPath, manifestPath });

    expect(loaded.catalog.catalogVersion).toBe('2026-08-31');
    expect(loaded.manifest.manifestVersion).toBe('2026-09-01');
    expect(loaded.catalogDigest).toBe(
      'sha256:1783d0cf20b045679dd584fad52b8995a2bd40cfa8f5e179fd99f4977d4c1bf6'
    );
    expect(loaded.catalogDigest).toBe(canonicalCatalogDigest(loaded.catalog));
  });

  test('rejects a manifest digest drift without exposing file contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'edutrack-config-manifest-'));
    const manifest = readFileSync(manifestPath, 'utf8').replace(
      'sha256:1783d0cf20b045679dd584fad52b8995a2bd40cfa8f5e179fd99f4977d4c1bf6',
      `sha256:${'0'.repeat(64)}`
    );
    const alteredManifestPath = join(root, 'manifest.yaml');
    writeFileSync(alteredManifestPath, manifest, { mode: 0o400 });

    expect(() =>
      loadCatalogAndManifest({ catalogPath, manifestPath: alteredManifestPath })
    ).toThrowError(expect.objectContaining({ code: 'CONFIG_CATALOG_DIGEST_MISMATCH' }));
    try {
      loadCatalogAndManifest({ catalogPath, manifestPath: alteredManifestPath });
    } catch (error) {
      expect((error as ManifestLoadError).message).not.toContain('1783d0');
    }
  });

  test('rejects duplicate catalog source/name definitions before any source can be opened', () => {
    const root = mkdtempSync(join(tmpdir(), 'edutrack-config-catalog-'));
    const catalog = readFileSync(catalogPath, 'utf8');
    const duplicated = catalog.replace(
      '  - id: edutrack.session_secret\n',
      '  - id: edutrack.database_url_duplicate\n    name: DATABASE_URL\n    appId: edutrack\n    sourceId: edutrack.shared_env\n    consumerIds: [edutrack.web]\n    category: database\n    description: Duplicate metadata\n    sensitivity: secret\n    requirement: required\n    mutability: managed\n    applyStrategy: runtime_restart\n    precedenceId: edutrack.shared_env_runtime\n  - id: edutrack.session_secret\n'
    );
    const alteredCatalogPath = join(root, 'catalog.yaml');
    writeFileSync(alteredCatalogPath, duplicated, { mode: 0o400 });

    expect(() =>
      loadCatalogAndManifest({ catalogPath: alteredCatalogPath, manifestPath })
    ).toThrowError(expect.objectContaining({ code: 'CONFIG_CATALOG_DUPLICATE_DEFINITION' }));
  });
});
