import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  parseCatalog,
  parseAgentManifest,
  type Catalog,
  type AgentManifest
} from '../../../packages/config-contracts/src/index.js';

export type ManifestLoadErrorCode =
  | 'CONFIG_CATALOG_READ_FAILED'
  | 'CONFIG_MANIFEST_READ_FAILED'
  | 'CONFIG_CATALOG_INVALID'
  | 'CONFIG_MANIFEST_INVALID'
  | 'CONFIG_CATALOG_VERSION_MISMATCH'
  | 'CONFIG_CATALOG_DIGEST_MISMATCH'
  | 'CONFIG_CATALOG_DUPLICATE_DEFINITION'
  | 'CONFIG_MANIFEST_REFERENCE_INVALID'
  | 'CONFIG_MANIFEST_NOT_READ_ONLY';

export class ManifestLoadError extends Error {
  readonly code: ManifestLoadErrorCode;

  constructor(code: ManifestLoadErrorCode) {
    super(code);
    this.name = 'ManifestLoadError';
    this.code = code;
  }
}

export type LoadedCatalogAndManifest = Readonly<{
  catalog: Catalog;
  manifest: AgentManifest;
  catalogDigest: string;
}>;

type ReadFile = (path: string) => string;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalCatalogBytes(catalog: Catalog): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalize(catalog))}\n`, 'utf8');
}

export function canonicalCatalogDigest(catalog: Catalog): string {
  return `sha256:${createHash('sha256').update(canonicalCatalogBytes(catalog)).digest('hex')}`;
}

function readText(path: string, readFile: ReadFile, code: ManifestLoadErrorCode): string {
  try {
    return readFile(path);
  } catch {
    throw new ManifestLoadError(code);
  }
}

function validateReferences(catalog: Catalog, manifest: AgentManifest): void {
  const catalogAppIds = new Set(catalog.apps.map((app) => app.id));
  const catalogConsumerIds = new Set(catalog.consumers.map((consumer) => consumer.id));
  const catalogSourceIds = new Set(manifest.sources.map((source) => source.id));
  const catalogEntryKeys = new Set<string>();

  for (const app of manifest.apps) {
    if (!catalogAppIds.has(app.id))
      throw new ManifestLoadError('CONFIG_MANIFEST_REFERENCE_INVALID');
  }

  for (const source of manifest.sources) {
    if (!catalogAppIds.has(source.appId)) {
      throw new ManifestLoadError('CONFIG_MANIFEST_REFERENCE_INVALID');
    }
    for (const consumerId of source.consumerIds ?? []) {
      if (!catalogConsumerIds.has(consumerId)) {
        throw new ManifestLoadError('CONFIG_MANIFEST_REFERENCE_INVALID');
      }
    }
  }

  if (manifest.build) {
    const catalogIds = new Set(catalog.entries.map((entry) => entry.id));
    for (const catalogId of manifest.build.publicCatalogIds) {
      const entry = catalog.entries.find((candidate) => candidate.id === catalogId);
      if (
        !entry ||
        !catalogIds.has(catalogId) ||
        entry.sensitivity !== 'public' ||
        entry.buildAllowed !== true
      ) {
        throw new ManifestLoadError('CONFIG_MANIFEST_REFERENCE_INVALID');
      }
    }
  }

  for (const entry of catalog.entries) {
    const key = `${entry.sourceId}\u0000${entry.name}`;
    if (catalogEntryKeys.has(key)) {
      throw new ManifestLoadError('CONFIG_CATALOG_DUPLICATE_DEFINITION');
    }
    catalogEntryKeys.add(key);

    const source = manifest.sources.find((candidate) => candidate.id === entry.sourceId);
    if (!source || source.appId !== entry.appId) {
      throw new ManifestLoadError('CONFIG_MANIFEST_REFERENCE_INVALID');
    }
    if (source.mutability === 'observed' && entry.mutability !== 'observed') {
      throw new ManifestLoadError('CONFIG_MANIFEST_REFERENCE_INVALID');
    }
  }

  for (const source of manifest.sources) {
    if (!catalogSourceIds.has(source.id)) {
      throw new ManifestLoadError('CONFIG_MANIFEST_REFERENCE_INVALID');
    }
  }
}

function validateCatalogDefinitionKeys(catalog: Catalog): void {
  const keys = new Set<string>();
  for (const entry of catalog.entries) {
    const key = `${entry.sourceId}\u0000${entry.name}`;
    if (keys.has(key)) throw new ManifestLoadError('CONFIG_CATALOG_DUPLICATE_DEFINITION');
    keys.add(key);
  }
}

export function loadCatalogAndManifest(
  input: Readonly<{
    catalogPath: string;
    manifestPath: string;
    readFile?: ReadFile;
  }>
): LoadedCatalogAndManifest {
  const readFile = input.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const catalogText = readText(input.catalogPath, readFile, 'CONFIG_CATALOG_READ_FAILED');
  const manifestText = readText(input.manifestPath, readFile, 'CONFIG_MANIFEST_READ_FAILED');

  let catalog: Catalog;
  try {
    catalog = parseCatalog(catalogText);
  } catch {
    throw new ManifestLoadError('CONFIG_CATALOG_INVALID');
  }
  let manifest: AgentManifest;
  try {
    manifest = parseAgentManifest(manifestText);
  } catch {
    throw new ManifestLoadError('CONFIG_MANIFEST_INVALID');
  }
  validateCatalogDefinitionKeys(catalog);
  if (!manifest.readOnly) throw new ManifestLoadError('CONFIG_MANIFEST_NOT_READ_ONLY');
  if (manifest.catalogVersion !== catalog.catalogVersion) {
    throw new ManifestLoadError('CONFIG_CATALOG_VERSION_MISMATCH');
  }
  const catalogDigest = canonicalCatalogDigest(catalog);
  if (manifest.catalogDigest !== catalogDigest) {
    throw new ManifestLoadError('CONFIG_CATALOG_DIGEST_MISMATCH');
  }
  validateReferences(catalog, manifest);
  return { catalog, manifest, catalogDigest };
}

export const loadManifestAndCatalog = loadCatalogAndManifest;
